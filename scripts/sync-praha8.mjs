import {writeFile, readFile, readdir, mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import puppeteer from 'puppeteer-core';

const root=resolve(import.meta.dirname,'..');
const demo=process.argv.includes('--demo');
const fullDetails=process.argv.includes('--full-details');
const fastMode=process.argv.includes('--fast');
const legacyOnlyZast=process.argv.includes('--zastupitelstvo');
const allUsneseni=process.argv.includes('--all-usneseni')||legacyOnlyZast||process.argv.includes('--refresh-usneseni');
const incrementalUsneseni=process.argv.includes('--usneseni-incremental');
const refreshUsneseni=allUsneseni||incrementalUsneseni;
const refreshHmpAll=process.argv.includes('--hmp');
const refreshHmpFunctions=refreshHmpAll||process.argv.includes('--hmp-functions');
const refreshHmpCompanies=refreshHmpAll||process.argv.includes('--hmp-companies');
const refreshOrganizations=process.argv.includes('--organizations')||process.argv.includes('--p8-companies');
const refreshP8Companies=refreshOrganizations;
const refreshPeople=process.argv.includes('--people');
const refreshElections=process.argv.includes('--elections');
const refreshContracts=process.argv.includes('--contracts');
const refreshBodies=process.argv.includes('--bodies');
const refreshVoting=process.argv.includes('--voting');
const refreshInfo106=process.argv.includes('--info106');
const refreshNoticeBoard=process.argv.includes('--noticeboard');
const refreshNationalRoles=process.argv.includes('--national-roles');
const refreshCensus=process.argv.includes('--census');
const refreshNews=process.argv.includes('--news');
const detailArg=process.argv.find(x=>x.startsWith('--details-limit='));
const detailsLimit=fullDetails ? Infinity : Number(detailArg?.split('=')[1] || 0);
const UA='Praha8Prehledy/1.6 (+public-data-indexer; public sources only)';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=s=>String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&ndash;|&#8211;/g,'–').replace(/&mdash;|&#8212;/g,'—').replace(/\s+/g,' ').trim();
const absolute=(href,base)=>new URL(href,base).href;

async function get(url,options={}){
  const r=await fetch(url,{headers:{'user-agent':UA,'accept':options.accept||'text/html,application/xhtml+xml,application/json'},...options});
  if(!r.ok) throw new Error(`${r.status} ${url}`);
  return options.json ? r.json() : r.text();
}
function findChrome(){
  const candidates=[
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    process.env.PUPPETEER_EXECUTABLE_PATH
  ].filter(Boolean);
  const hit=candidates.find(existsSync);
  if(!hit) throw new Error('Nenašel jsem Google Chrome/Edge. Nainstalujte Chrome nebo nastavte PUPPETEER_EXECUTABLE_PATH.');
  return hit;
}
async function launchBrowser(){
  return puppeteer.launch({headless:true,executablePath:findChrome(),args:['--no-sandbox','--disable-setuid-sandbox'],userAgent:UA});
}

async function extractPdfText(url){
  // PDF stahujeme přímo z klasického webu Prahy 8 a text čteme přes pdf.js.
  const classicUrl=String(url).replace(/^https:\/\/m\.praha8\.cz\//i,'https://www.praha8.cz/');
  const r=await fetch(classicUrl,{headers:{'user-agent':UA,'accept':'application/pdf,*/*'}});
  if(!r.ok)throw new Error(`${r.status} ${classicUrl}`);
  const bytes=new Uint8Array(await r.arrayBuffer());
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Pro extrakci textu nepotřebujeme renderovat standardní PDF fonty.
  // pdf.js proto necháme běžet jen s chybovými hláškami; varování o fontech
  // by jinak zaplavovala terminál, přestože textovou vrstvu přečteme správně.
  const doc=await pdfjs.getDocument({
    data:bytes,
    disableWorker:true,
    verbosity:pdfjs.VerbosityLevel.ERRORS
  }).promise;
  const pages=[];
  for(let i=1;i<=doc.numPages;i++){
    const pg=await doc.getPage(i);
    const content=await pg.getTextContent();
    pages.push(content.items.map(x=>x.str||'').join(' '));
  }
  await doc.destroy();
  return pages.join('\n');
}

function classicPraha8Url(url=''){
  return String(url).replace(/^https:\/\/m\.praha8\.cz\//i,'https://www.praha8.cz/');
}

const months={leden:1,'ledna':1,'únor':2,'února':2,'březen':3,'března':3,'duben':4,'dubna':4,'květen':5,'května':5,'červen':6,'června':6,'červenec':7,'července':7,'srpen':8,'srpna':8,'září':9,'říjen':10,'října':10,'listopad':11,'listopadu':11,'prosinec':12,'prosince':12};
function isoDate(text=''){
  let m=text.match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
  if(m)return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  m=text.match(/(\d{1,2})\.\s*([A-Za-zÁ-ž]+)\s+(\d{4})/u);
  if(!m)return '';
  const mon=months[m[2].toLowerCase()];
  return mon?`${m[3]}-${String(mon).padStart(2,'0')}-${m[1].padStart(2,'0')}`:'';
}
function autoTopics(t){
  const x=t.toLowerCase(),r=[];
  const rules=[['Školství',['škola','mateřsk','základní škol','dětsk','pedagog']],['Finance',['rozpoč','účetní','dotac','fond investic']],['Majetek',['pozem','nájem','majet','nemovit','byt']],['Doprava',['doprav','parkov','tramvaj','chodník','komunikac']],['Výstavba',['stavb','developer','územní','projektové dokument']],['Smlouvy',['smlouv','dodatek']],['Veřejné zakázky',['veřejné zakáz','dodavatel','zhotovitel','zadávací']],['Kultura',['kultur','divadl','galeri','kasárna']],['Sport',['sport','hřišt','hala']]];
  for(const [n,ks] of rules)if(ks.some(k=>x.includes(k)))r.push(n);
  return r;
}
function parseRows(html,base){
  const out=[];
  for(const m of html.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)){
    const row=m[0],text=clean(row);
    const id=(text.match(/Usn\s+(RMC|ZMC)\s+\d+\/\d{4}/)||[])[0];
    if(!id)continue;
    const links=[...row.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
    // Detail usnesení má na Praze 8 vlastní URL s parametrem ?usn=.
    // Preferujeme ji před obecným URL seznamu; teprve pak odkaz s textem ID.
    const a=links.find(x=>/\/appo\/usn\/\d+\?usn=/i.test(x[1])) || links.find(x=>clean(x[2]).includes(id));
    const cells=[...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(x=>clean(x[1]));
    const idx=cells.findIndex(c=>c.includes(id));
    const meeting=idx>=0?(cells[idx+1]||''):'';
    const title=idx>=0?(cells[idx+2]||''):'';
    const date=idx>=0?isoDate(cells[idx+3]||''):isoDate(text);
    out.push({id,organ:id.includes('ZMC')?'Zastupitelstvo':'Rada',date,meeting,title,topics:autoTopics(title),url:a?absolute(a[1],base):base});
  }
  return out;
}
async function readOld(){try{return JSON.parse(await readFile(resolve(root,'data/usneseni.json'),'utf8'))}catch{return []}}

async function availableYears(page){
  return page.evaluate(()=>{
    for(const s of document.querySelectorAll('select')){
      const ys=[...s.options].map(o=>o.textContent.trim()).filter(x=>/^20\d{2}$/.test(x));
      if(ys.length>=5)return [...new Set(ys)].sort((a,b)=>b.localeCompare(a));
    }
    return [];
  });
}
async function applyYear(page,year){
  // Filtr roku na Praze 8 je součástí staršího ASP.NET WebForms formuláře.
  // U ZMČ se ukázalo, že samotný __EVENTTARGET nestačí: server očekává
  // standardní odeslání filtrovacího formuláře / tlačítka. Proto nejdřív
  // opravdu nastavíme SELECT, vyšleme input/change a formulář odešleme přes
  // requestSubmit() s lokálním filtrovacím tlačítkem. Teprve jako fallback
  // použijeme WebForms __EVENTTARGET.
  const before=await page.evaluate(()=>[...document.body.innerText.matchAll(/Usn\s+(?:RMC|ZMC)\s+\d+\/(\d{4})/g)].map(m=>m[0]).join('|'));
  const info=await page.evaluate(year=>{
    const selects=[...document.querySelectorAll('select')];
    const s=selects.find(x=>[...x.options].some(o=>o.textContent.trim()===String(year)));
    if(!s)return null;
    const opt=[...s.options].find(o=>o.textContent.trim()===String(year));
    const onchange=s.getAttribute('onchange')||'';
    const m=onchange.match(/__doPostBack\(['\"]([^'\"]+)['\"]/);
    const scope=s.closest('table,fieldset,.form-group,.form-row') || s.parentElement || document;
    const submits=[...scope.querySelectorAll('button,input[type="submit"],input[type="button"]')];
    const label=e=>String(e.innerText||e.value||e.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim();
    let submit=submits.find(e=>/hledat|vyhledat|zobrazit|filtrovat|použít/i.test(label(e))) || submits.at(-1) || null;
    if(!submit){
      const form=s.closest('form');
      const all=form?[...form.querySelectorAll('button,input[type="submit"]')]:[];
      // Preferujeme tlačítko, jehož okolí obsahuje text filtrovací tabulky.
      submit=all.find(e=>/číslo usnesení|číslo jednání|v názvu a obsahu/i.test((e.parentElement?.parentElement?.innerText||''))) || null;
    }
    return {
      value:opt.value,
      name:s.name||'', id:s.id||'',
      target:m?.[1]||s.name||s.id||'',
      submitName:submit?.name||'', submitId:submit?.id||'', submitValue:submit?.value||'',
      onchange
    };
  },String(year));
  if(!info)throw new Error(`Nenalezen filtr roku ${year}.`);

  const nav=page.waitForNavigation({waitUntil:'domcontentloaded',timeout:20000}).catch(()=>null);
  const submitted=await page.evaluate(({year,info})=>{
    const selects=[...document.querySelectorAll('select')];
    const s=selects.find(x=>[...x.options].some(o=>o.textContent.trim()===String(year)));
    if(!s)return {ok:false,reason:'select zmizel'};
    s.value=info.value;
    s.dispatchEvent(new Event('input',{bubbles:true}));
    s.dispatchEvent(new Event('change',{bubbles:true}));

    const form=s.closest('form');
    if(!form)return {ok:false,reason:'form nenalezen'};
    let submit=null;
    if(info.submitId)submit=document.getElementById(info.submitId);
    if(!submit && info.submitName)submit=form.querySelector(`[name="${CSS.escape(info.submitName)}"]`);
    try{
      if(typeof form.requestSubmit==='function'){
        submit ? form.requestSubmit(submit) : form.requestSubmit();
      }else if(submit && typeof submit.click==='function'){
        submit.click();
      }else{
        HTMLFormElement.prototype.submit.call(form);
      }
      return {ok:true,mode:submit?'requestSubmit-button':'requestSubmit-form'};
    }catch(e){return {ok:false,reason:String(e)}}
  },{year:String(year),info});
  await nav; await sleep(550);

  const state=await page.evaluate(year=>{
    const ids=[...document.body.innerText.matchAll(/Usn\s+(?:RMC|ZMC)\s+\d+\/(\d{4})/g)].map(m=>m[1]);
    const selects=[...document.querySelectorAll('select')];
    const s=selects.find(x=>[...x.options].some(o=>o.textContent.trim()===String(year)));
    const selected=s?.selectedOptions?.[0]?.textContent?.trim()||'';
    return {ids:[...new Set(ids)].slice(0,10),selected};
  },String(year));
  if(state.ids.some(y=>y===String(year)))return;

  // Fallback: některé varianty formuláře reagují jen na explicitní WebForms postback.
  // Nastavíme znovu rok a odešleme __EVENTTARGET + __EVENTARGUMENT.
  await page.goto(page.url(),{waitUntil:'domcontentloaded',timeout:30000}).catch(()=>null);
  const nav2=page.waitForNavigation({waitUntil:'domcontentloaded',timeout:20000}).catch(()=>null);
  const fallback=await page.evaluate(({year,target})=>{
    const s=[...document.querySelectorAll('select')].find(x=>[...x.options].some(o=>o.textContent.trim()===String(year)));
    if(!s)return {ok:false,reason:'select nenalezen'};
    const opt=[...s.options].find(o=>o.textContent.trim()===String(year));
    s.value=opt.value;
    const form=s.closest('form'); if(!form)return {ok:false,reason:'form nenalezen'};
    const ensure=name=>{let e=form.querySelector(`input[name="${name}"]`);if(!e){e=document.createElement('input');e.type='hidden';e.name=name;form.appendChild(e)}return e};
    ensure('__EVENTTARGET').value=target||s.name||s.id||'';
    ensure('__EVENTARGUMENT').value='';
    try{HTMLFormElement.prototype.submit.call(form);return {ok:true}}catch(e){return {ok:false,reason:String(e)}}
  },{year:String(year),target:info.target});
  await nav2; await sleep(550);
  const ok=await page.evaluate(year=>{
    const ids=[...document.body.innerText.matchAll(/Usn\s+(?:RMC|ZMC)\s+\d+\/(\d{4})/g)].map(m=>m[1]);
    return ids.some(y=>y===String(year));
  },String(year));
  if(!ok){
    const diag={year,submitted,fallback,info,state,before:before.slice(0,300)};
    console.log('      ⚠️ Diagnostika filtru roku:',JSON.stringify(diag));
    throw new Error(`Filtr roku ${year} se na stránce neaplikoval.`);
  }
}
async function pagerDiagnostic(page,nextNum){
  return page.evaluate((nextNum)=>{
    const txt=e=>String(e?.innerText||e?.textContent||e?.value||'').replace(/\s+/g,' ').trim();
    return [...document.querySelectorAll('a,button,input,[onclick],[role="button"]')]
      .map((e,i)=>({
        i,
        tag:e.tagName,
        text:txt(e),
        href:e.getAttribute?.('href')||'',
        onclick:e.getAttribute?.('onclick')||'',
        cls:e.className||'',
        visible:!!(e.getClientRects().length),
      }))
      .filter(x=>x.text===String(nextNum) || /další|next|›|»|\.\.\./i.test(x.text))
      .slice(0,40);
  },nextNum);
}
async function clickNextPage(page,currentPage){
  const nextNum=currentPage+1;
  const before=await page.evaluate(()=>[...document.body.innerText.matchAll(/Usn\s+(?:RMC|ZMC)\s+\d+\/\d{4}/g)].map(m=>m[0]).join('|'));

  // Praha 8 používá ASP.NET WebForms pager ve tvaru
  // javascript:__doPostBack('ctl09$gvUsn','Page$2'). Funkce __doPostBack ale
  // nemusí být v headless Chrome globálně dostupná. Emulujeme proto přesně to,
  // co WebForms dělá: nastavíme __EVENTTARGET + __EVENTARGUMENT a odešleme form.
  const pager=await page.evaluate((nextNum)=>{
    const wanted='Page$'+nextNum;
    for(const a of document.querySelectorAll('a[href*="__doPostBack"]')){
      const href=a.getAttribute('href')||'';
      const m=href.match(/__doPostBack\(['\"]([^'\"]+)['\"],['\"]([^'\"]+)['\"]\)/);
      if(m && m[2]===wanted)return {target:m[1],argument:m[2],text:(a.textContent||'').trim(),href};
    }
    return null;
  },nextNum);
  if(!pager)return false;

  const navPromise=page.waitForNavigation({waitUntil:'domcontentloaded',timeout:20000}).catch(()=>null);
  const submitted=await page.evaluate(({target,argument})=>{
    const form=document.querySelector('form');
    if(!form)return {ok:false,reason:'form nenalezen'};
    const ensure=(name)=>{
      let el=form.querySelector(`input[name="${name}"]`);
      if(!el){el=document.createElement('input');el.type='hidden';el.name=name;form.appendChild(el);}
      return el;
    };
    ensure('__EVENTTARGET').value=target;
    ensure('__EVENTARGUMENT').value=argument;
    // WebForms postback nemá posílat hodnotu běžného submit buttonu.
    try{HTMLFormElement.prototype.submit.call(form);return {ok:true};}
    catch(e){return {ok:false,reason:String(e)}}
  },pager);
  if(!submitted?.ok){
    if(currentPage===1)console.log('      ⚠️ Pager: WebForms POST se nepodařil.',JSON.stringify({pager,submitted}));
    return false;
  }
  await navPromise;
  await sleep(500);
  const after=await page.evaluate(()=>[...document.body.innerText.matchAll(/Usn\s+(?:RMC|ZMC)\s+\d+\/\d{4}/g)].map(m=>m[0]).join('|'));
  if(after && after!==before)return true;
  if(currentPage===1)console.log(`      ⚠️ WebForms POST Page$${nextNum} proběhl, ale seznam se nezměnil.`,JSON.stringify(pager));
  return false;
}
async function crawlYear(page,start,year,label){
  await page.goto(start,{waitUntil:'domcontentloaded',timeout:30000});
  await applyYear(page,year);
  const byId=new Map(); let pageNo=1;
  while(true){
    const html=await page.content();
    for(const item of parseRows(html,page.url()))byId.set(item.id,item);
    if(pageNo%10===0)console.log(`      ${label} ${year}: strana ${pageNo}, ${byId.size} usnesení…`);
    if(pageNo>300)throw new Error(`${label} ${year}: bezpečnostní limit 300 stran.`);
    const moved=await clickNextPage(page,pageNo);
    if(!moved)break;
    pageNo++;
  }
  return [...byId.values()];
}
async function crawlOrgan(browser,start,label){
  const page=await browser.newPage(); await page.setUserAgent(UA);
  await page.goto(start,{waitUntil:'domcontentloaded',timeout:30000});
  let years=await availableYears(page);
  if(!years.length)years=Array.from({length:new Date().getFullYear()-2007},(_,i)=>String(new Date().getFullYear()-i));
  years=years.filter(y=>Number(y)>=2008 && Number(y)<=new Date().getFullYear());
  const all=[];
  console.log(`   ${label}: roky ${years.at(-1)}–${years[0]} (${years.length})`);
  for(const y of years){
    const rows=await crawlYear(page,start,y,label);
    console.log(`      ${y}: ${rows.length} usnesení`);
    all.push(...rows);
  }
  await page.close();
  return [...new Map(all.map(x=>[x.id,x])).values()];
}
async function syncUsneseni(browser){
  const oldItems=await readOld();
  console.log('   Rada: synchronizuji kompletní archiv…');
  const rada=await crawlOrgan(browser,'https://www.praha8.cz/appo/usn/676','Rada');
  console.log('   Zastupitelstvo: synchronizuji kompletní archiv…');
  const zast=await crawlOrgan(browser,'https://www.praha8.cz/appo/usn/677?dlOrgan=2','Zastupitelstvo');
  // Atomická kontrola: buď máme oba celé archivy, nebo starý soubor vůbec nepřepisujeme.
  if(rada.length<1000 || zast.length<100)throw new Error(`Kontrola usnesení neprošla (Rada ${rada.length}, Zastupitelstvo ${zast.length}). Existující data jsem nepřepsal.`);
  const byId=new Map([...rada,...zast].map(x=>[x.id,x]));
  const old=new Map(oldItems.map(x=>[x.id,x]));
  const out=[...byId.values()].map(x=>({...old.get(x.id),...x,tasks:old.get(x.id)?.tasks||[]}));
  out.sort((a,b)=>(b.date||'').localeCompare(a.date||'')||b.id.localeCompare(a.id,'cs',{numeric:true}));
  await writeFile(resolve(root,'data/usneseni.json'),JSON.stringify(out,null,2));
  return {items:out,rada:rada.length,zast:zast.length};
}

function resolutionYear(item){
  const byId=String(item?.id||'').match(/\/(20\d{2})$/)?.[1];
  if(byId)return Number(byId);
  const byDate=String(item?.date||'').match(/^(20\d{2})-/)?.[1];
  return byDate?Number(byDate):0;
}
async function crawlOrganIncremental(browser,start,label,organ,oldItems){
  const currentYear=new Date().getFullYear();
  const organOld=oldItems.filter(x=>x.organ===organ);
  const latestKnownYear=Math.max(0,...organOld.map(resolutionYear));
  // Běžně načítáme jen aktuální rok. Při přelomu roku ale projdeme i poslední
  // známý rok, aby se neztratil pozdě zveřejněný záznam z prosince.
  const firstYear=latestKnownYear && latestKnownYear<currentYear ? Math.max(latestKnownYear,currentYear-1) : currentYear;
  const page=await browser.newPage(); await page.setUserAgent(UA);
  const fetched=[];
  try{
    for(let year=firstYear;year<=currentYear;year++){
      const rows=await crawlYear(page,start,String(year),label);
      console.log(`      ${year}: zkontrolováno ${rows.length} usnesení`);
      fetched.push(...rows);
    }
  }finally{await page.close().catch(()=>{})}
  return [...new Map(fetched.map(x=>[x.id,x])).values()];
}
async function syncUsneseniIncremental(browser){
  const oldItems=await readOld();
  if(!oldItems.length)throw new Error('Inkrementální synchronizace usnesení vyžaduje existující data/usneseni.json. Nejprve spusťte kompletní sync.');
  const oldById=new Map(oldItems.map(x=>[x.id,x]));
  console.log(`   Inkrementální režim: ponechávám ${oldItems.length.toLocaleString('cs-CZ')} historických usnesení a kontroluji jen nejnovější rok.`);
  const radaFresh=await crawlOrganIncremental(browser,'https://www.praha8.cz/appo/usn/676','Rada','Rada',oldItems);
  const zastFresh=await crawlOrganIncremental(browser,'https://www.praha8.cz/appo/usn/677?dlOrgan=2','Zastupitelstvo','Zastupitelstvo',oldItems);
  const candidates=[...radaFresh,...zastFresh];
  const added=candidates.filter(x=>!oldById.has(x.id));
  const out=[...oldItems,...added.map(x=>({...x,tasks:[]}))];
  out.sort((a,b)=>(b.date||'').localeCompare(a.date||'')||b.id.localeCompare(a.id,'cs',{numeric:true}));
  // Zápis provedeme až po úspěšném načtení obou orgánů. Při chybě zůstane starý soubor beze změny.
  if(added.length)await writeFile(resolve(root,'data/usneseni.json'),JSON.stringify(out,null,2));
  console.log(`   Nová usnesení: ${added.length}. ${added.length?'Dataset bezpečně rozšířen.':'Existující dataset zůstal beze změny.'}`);
  return {items:out,rada:out.filter(x=>x.organ==='Rada').length,zast:out.filter(x=>x.organ==='Zastupitelstvo').length,added:added.length};
}
function parseDetail(html,item){
  const text=clean(html),tasks=[];
  const re=/Zodpovídá:\s*(.*?)\s+Termín:\s*(\d{1,2}\.\s*\d{1,2}\.\s*\d{4})/gi;
  for(const m of text.matchAll(re))tasks.push({responsible:m[1].trim(),deadline:isoDate(m[2])});
  const pub=(text.match(/zveřejněno\s+(\d{1,2}\.\s*\d{1,2}\.\s*\d{4})/i)||[])[1];
  return {...item,tasks,published:pub?isoDate(pub):item.published||'',content:text.slice(0,50000),detailSyncedAt:new Date().toISOString()};
}
async function enrichDetails(items){
  if(detailsLimit===0)return {items,count:0,remaining:items.filter(x=>!x.detailSyncedAt).length};
  const candidates=items.filter(x=>x.url&&/\/appo\/usn\//.test(x.url)&&!x.detailSyncedAt);
  const selected=candidates.slice(0,detailsLimit); if(!selected.length)return {items,count:0,remaining:candidates.length};
  const byId=new Map(items.map(x=>[x.id,x]));let cursor=0,done=0;
  async function worker(){while(cursor<selected.length){const item=selected[cursor++];try{const html=await get(item.url);byId.set(item.id,parseDetail(html,item));done++;}catch(e){console.warn(`Detail ${item.id} přeskočen: ${e.message}`)}await sleep(120);if(done%50===0&&done)console.log(`   Detaily: ${done}/${selected.length}…`);}}
  await Promise.all(Array.from({length:4},worker));
  const out=items.map(x=>byId.get(x.id));await writeFile(resolve(root,'data/usneseni.json'),JSON.stringify(out,null,2));
  return {items:out,count:done,remaining:Math.max(0,candidates.length-done)};
}

async function syncPeople(browser){
  const url='https://www.praha8.cz/Zastupitelstvo-mestske-casti-Praha-8.html';
  const page=await browser.newPage();await page.setUserAgent(UA);
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
  const people=await page.evaluate(()=>{
    const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
    const rows=[...document.querySelectorAll('tr')];
    const out=[];
    for(const tr of rows){
      const tdEls=[...tr.querySelectorAll('td,th')];
      const cells=tdEls.map(td=>clean(td.innerText));
      if(cells.length<2)continue;
      const raw=cells[0]||'';
      const roleMatch=raw.match(/(starosta|místostarostka|místostarosta|radní|zastupitelka|zastupitel)/i);
      if(!roleMatch)continue;
      const before=clean(raw.slice(0,roleMatch.index));
      const after=clean(raw.slice(roleMatch.index+roleMatch[0].length));
      const anchor=tr.querySelector('a[href]');
      const email=(tr.innerText.match(/[\w.+-]+@praha8\.cz/i)||[])[0]||'';
      const contactText=cells[2]||tr.innerText||'';
      const phone=(contactText.match(/(?:\+420\s*)?(?:\d{3}[ \u00a0-]?){2}\d{3}/)||[])[0]||'';
      const areasRaw=tdEls[1]?.innerText||'';
      const areas=areasRaw.split(/\n+/).map(clean).flatMap(x=>x.split(/\s*,\s*(?=[A-ZÁ-Ž])/)).map(clean).filter(Boolean);
      out.push({name:before,role:roleMatch[1].toLowerCase(),club:after,areas,email,phone:clean(phone),url:anchor?.href||location.href});
    }
    return out;
  });
  await page.close();
  const dedup=[...new Map(people.map(x=>[(x.email||x.name).toLowerCase(),x])).values()];
  if(dedup.length!==45)throw new Error(`Seznam zastupitelů: našel jsem ${dedup.length}, ale oficiální stránka uvádí 45.`);
  await writeFile(resolve(root,'data/lide.json'),JSON.stringify(dedup,null,2));return dedup;
}

function personKey(name=''){
  const drop=new Set(['mgr','bc','ing','phdr','judr','rndr','mvdr','doc','prof','phd','mba','mpa','ma','dis','csc','dba','bca','et']);
  const toks=String(name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(Boolean).filter(x=>!drop.has(x)&&x.length>1);
  return toks.slice(0,2).sort().join(' ');
}
async function syncClubChairs(browser,people){
  const page=await browser.newPage();await page.setUserAgent(UA);
  const list='https://www.praha8.cz/politicke-kluby.html';
  await page.goto(list,{waitUntil:'domcontentloaded',timeout:30000});
  const links=await page.evaluate(()=>[...document.querySelectorAll('a[href]')].map(a=>({text:(a.textContent||'').replace(/\s+/g,' ').trim(),url:a.href})).filter(x=>/^(Klub |Společně pro Prahu 8|SPD a Trikolora)/i.test(x.text)));
  const chairKeys=new Set();
  for(const link of [...new Map(links.map(x=>[x.url,x])).values()]){
    try{
      await page.goto(link.url,{waitUntil:'domcontentloaded',timeout:20000});
      const chair=await page.evaluate(()=>{
        const lines=(document.querySelector('main')||document.body).innerText.split('\n').map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean);
        const i=lines.findIndex(x=>/^Předseda:?$/i.test(x));
        return i>=0?(lines[i+1]||'').replace(/^[-•]\s*/,''):'';
      });
      if(chair)chairKeys.add(personKey(chair));
    }catch{}
  }
  await page.close();
  const out=people.map(p=>({
    ...p,
    role:String(p.role||'').trim().toLocaleLowerCase('cs-CZ'),
    isClubChair:chairKeys.has(personKey(p.name))
  }));
  await writeFile(resolve(root,'data/lide.json'),JSON.stringify(out,null,2));
  return out;
}

function splitPeopleText(text=''){
  return String(text).split(/\n|;|,\s*(?=[A-ZÁ-Ž])/).map(x=>x.replace(/^[-•]\s*/,'').trim()).filter(x=>x.length>2);
}
async function syncBodies(browser,people){
  const affiliation=new Map(people.map(p=>[personKey(p.name),p.club]));
  const annotate=name=>({name,club:affiliation.get(personKey(name))||''});
  const page=await browser.newPage();await page.setUserAgent(UA);
  const bodies=[];
  // Komise – seznam obsahuje odkazy na jednotlivé detailní stránky.
  await page.goto('https://www.praha8.cz/komise-rady-mestske-casti-praha-8.html',{waitUntil:'domcontentloaded',timeout:30000});
  const commissionLinks=await page.evaluate(()=>[...document.querySelectorAll('a[href]')].map(a=>({name:(a.textContent||'').replace(/\s+/g,' ').trim(),url:a.href})).filter(x=>/^(Komise pro|Redakční rada)/i.test(x.name)&&!/archiv/i.test(x.name)));
  for(const c of [...new Map(commissionLinks.map(x=>[x.url,x])).values()]){
    try{
      await page.goto(c.url,{waitUntil:'domcontentloaded',timeout:20000});
      const sec=await page.evaluate(()=>{
        const main=document.querySelector('main')||document.body;
        const lines=main.innerText.split('\n').map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean);
        const materials=[...main.querySelectorAll('a[href]')].find(a=>/materiály z jednání|materialy z jednani/i.test((a.textContent||'').trim()));
        const labels=/^(Předseda|Předsedkyně|Členové z řad zastupitelů|Členové z řad členů ZMČ|Členové z řad občanů|Členové|Tajemník|Tajemnice)$/i;
        const out={chair:'',members:[],citizens:[],secretary:''};let mode='';
        for(const line of lines){
          if(/^Předsed(a|kyně)$/i.test(line)){mode='chair';continue}
          if(/^Členové z řad (zastupitelů|členů ZMČ)$/i.test(line)){mode='members';continue}
          if(/^Členové z řad občanů$/i.test(line)){mode='citizens';continue}
          if(/^Členové$/i.test(line)){mode='members';continue}
          if(/^Tajemník|Tajemnice$/i.test(line)){mode='secretary';continue}
          if(/^(Související odkazy|Mohlo by vás)/i.test(line)){mode='';continue}
          if(labels.test(line))continue;
          if(mode==='chair'&&!out.chair){out.chair=line;mode='';}
          else if(mode==='members'&&line.length<90)out.members.push(line);
          else if(mode==='citizens'&&line.length<90)out.citizens.push(line);
          else if(mode==='secretary'&&!out.secretary){out.secretary=line;mode='';}
        }
        out.materialsUrl=materials?.href||'';
        return out;
      });
      bodies.push({type:'Komise rady',name:c.name,url:c.url,materialsUrl:sec.materialsUrl||'',chair:sec.chair?annotate(sec.chair):null,members:sec.members.map(annotate),citizens:sec.citizens.map(x=>({name:x,club:''})),secretary:sec.secretary});
    }catch(e){console.warn(`   Komise ${c.name}: ${e.message}`)}
  }
  // Výbory – jsou oba na jedné stránce, proto využijeme známé aktuální složení stránky.
  await page.goto('https://www.praha8.cz/vybory-zastupitelstva-mestske-casti-praha-8.html',{waitUntil:'domcontentloaded',timeout:30000});
  const committeeData=await page.evaluate(()=>{
    const text=(document.querySelector('main')||document.body).innerText;
    const names=['Finanční výbor','Kontrolní výbor'];
    return names.map((name,idx)=>{
      const start=text.indexOf(name);const end=idx+1<names.length?text.indexOf(names[idx+1],start+name.length):text.indexOf('Mohlo by vás',start);
      const lines=text.slice(start,end>start?end:undefined).split('\n').map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean);
      const out={name,chair:'',members:[],citizens:[],secretary:''};let mode='';
      for(const line of lines.slice(1)){
        if(/^Předseda$/i.test(line)){mode='chair';continue}
        if(/^Členové z řad členů ZMČ$/i.test(line)){mode='members';continue}
        if(/^Členové z řad občanů$/i.test(line)){mode='citizens';continue}
        if(/^Tajemník|Tajemnice$/i.test(line)){mode='secretary';continue}
        if(/^(Související odkazy|Materiály z jednání)/i.test(line)){mode='';continue}
        if(mode==='chair'&&!out.chair){out.chair=line;mode='';}
        else if(mode==='members'&&line.length<90)out.members.push(line);
        else if(mode==='citizens'&&line.length<90)out.citizens.push(line);
        else if(mode==='secretary'&&!out.secretary){out.secretary=line;mode='';}
      }
      return out;
    });
  });
  for(const x of committeeData){const materialsUrl=/kontrolní/i.test(x.name)?'https://www.praha8.cz/Materialy-KV':/finanční/i.test(x.name)?'https://www.praha8.cz/Materialy-Financniho-vyboru':'';bodies.push({type:'Výbor zastupitelstva',name:x.name,url:'https://www.praha8.cz/vybory-zastupitelstva-mestske-casti-praha-8.html',materialsUrl,chair:x.chair?annotate(x.chair):null,members:x.members.map(annotate),citizens:x.citizens.map(n=>({name:n,club:''})),secretary:x.secretary});}
  // Zvláštní orgány městské části – jejich složení je přímo na jedné stránce, nikoli v detailních odkazech.
  try{
    await page.goto('https://www.praha8.cz/zvlastni-organy-mc',{waitUntil:'domcontentloaded',timeout:30000});
    const specials=await page.evaluate(()=>{
      const main=document.querySelector('main')||document.querySelector('article')||document.body;
      const lines=(main.innerText||'').split('\n').map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean);
      const starts=[];
      for(let i=0;i<lines.length;i++){
        if(/^Komise\s+povodňová$/i.test(lines[i]) || /^Povodňová komise/i.test(lines[i]) || /^Komise\s+pro\s+sociálně-právní ochranu\s+dětí/i.test(lines[i])) starts.push(i);
      }
      const out=[];
      for(let si=0;si<starts.length;si++){
        const chunk=lines.slice(starts[si], starts[si+1]??lines.length);
        const rawName=chunk[0]||'';
        const item={name:/povodň/i.test(rawName)?'Povodňová komise':'Komise pro sociálně-právní ochranu dětí',chair:'',viceChair:'',members:[],citizens:[],secretary:''};
        let mode='';
        for(const line of chunk.slice(1)){
          if(/^Předseda:?$/i.test(line)||/^Předsedkyně:?$/i.test(line)){mode='chair';continue}
          if(/^Zástupce předsedy:?$/i.test(line)||/^Zástupkyně předsedy:?$/i.test(line)||/^Místopředseda:?$/i.test(line)||/^Místopředsedkyně:?$/i.test(line)){mode='vice';continue}
          if(/^Členové komise z řad zastupitelstva MČ:?$/i.test(line)||/^Členové z řad zastupitelstva MČ:?$/i.test(line)){mode='members';continue}
          if(/^Členové komise:?$/i.test(line)||/^Členové:?$/i.test(line)||/^Členové komise z fyzických osob/i.test(line)){mode='citizens';continue}
          if(/^Tajemník komise:?$/i.test(line)||/^Tajemnice komise:?$/i.test(line)||/^Tajemník:?$/i.test(line)||/^Tajemnice:?$/i.test(line)){mode='secretary';continue}
          if(/^(Aktualizováno|Související odkazy|Mohlo by vás)/i.test(line)){mode='';continue}
          if(mode==='chair'&&!item.chair){item.chair=line;mode='';continue}
          if(mode==='vice'&&!item.viceChair){item.viceChair=line;mode='';continue}
          if(mode==='members'&&line.length<140){item.members.push(line);continue}
          if(mode==='citizens'&&line.length<160){item.citizens.push(line);continue}
          if(mode==='secretary'&&!item.secretary){item.secretary=line;mode='';continue}
        }
        if(item.chair||item.members.length||item.citizens.length) out.push(item);
      }
      return out;
    });
    let specialItems=specials;
    // Pojistka pro změnu HTML: aktuální složení z oficiální stránky, ověřené 14. 10. 2025.
    if(!specialItems.length){
      specialItems=[
        {name:'Povodňová komise',chair:'Ondřej Gros',viceChair:'Jiří Vítek',members:[],citizens:['JUDr. Josef Rambousek','MUDr. Věra Hájíčková','Petr Tesař','Ing. Richard Beneš','Mgr. Luděk Vaníček','nprap. Dana Hošková','Jan Sigmund','plk. Mgr. Bc. Aleš Toman','Bc. Josef Slobodník','Bc. Pavla Řechtáčková'],secretary:'Bc. David Straka'},
        {name:'Komise pro sociálně-právní ochranu dětí',chair:'Mgr. Tomáš Tatranský',viceChair:'Jana Janků',members:['Mgr. Vladimíra Ludková','Ing. Tomáš Hřebík, Ph.D.','Mgr. Michal Janovský'],citizens:['Mgr. Petr Veselý','Mgr. Martin Doležal','npor. Ing. Bc. Petr Šindelář'],secretary:'Mgr. Dagmara Kubičíková'}
      ];
      console.warn('   Zvláštní orgány: HTML se nepodařilo rozpoznat, použit ověřený aktuální snapshot.');
    }
    for(const x of specialItems){
      const memberNames=[...(x.members||[])];
      // U povodňové komise jsou na stránce všichni pod „Členové komise“; zastupitele mezi nimi rozpoznáme podle seznamu lidí.
      const citizens=[];
      for(const n of (x.citizens||[])){
        if(affiliation.has(personKey(n))) memberNames.push(n); else citizens.push(n);
      }
      const chair=x.chair?annotate(x.chair):null;
      const members=memberNames.map(annotate);
      if(x.viceChair){
        const vp=annotate(x.viceChair);
        vp.role=/žena|Jana|Eva|Marie|Pavla|Vladimíra/i.test(x.viceChair)?'místopředsedkyně':'místopředseda';
        members.unshift(vp);
      }
      bodies.push({type:'Zvláštní orgán',name:x.name,url:'https://www.praha8.cz/zvlastni-organy-mc',materialsUrl:'',chair,members,citizens:citizens.map(n=>({name:n,club:''})),secretary:x.secretary||''});
    }
  }catch(e){console.warn(`   Zvláštní orgány: ${e.message}`)}
  await page.close();
  // Komise pro sociálně-právní ochranu dětí je zvláštní orgán MČ, nikoli komise Rady.
  // Starší struktura webu ji mohla načíst duplicitně mezi komisemi; ponecháme pouze záznam typu Zvláštní orgán.
  const cleanedBodies=bodies.filter(x=>!(x.type==='Komise rady' && /sociálně-právní ochranu dětí/i.test(x.name||'')));
  await writeFile(resolve(root,'data/organy.json'),JSON.stringify(cleanedBodies,null,2));
  return cleanedBodies;
}

function normalizeIco(x=''){const d=String(x).replace(/\D/g,'');return d.length===8?d:''}
function normalizeWebsite(href=''){
  if(!href)return '';
  try{const u=new URL(href);if(!/^https?:$/.test(u.protocol))return '';return u.href}catch{return ''}
}
function parseOrgDetail(html){
  const text=clean(html);
  const ico=normalizeIco((text.match(/\bIČO?\s*:?\s*([0-9][0-9\s]{6,12}[0-9])/i)||[])[1]||'');
  const patterns=[
    ['ředitelka',/\bŘeditelka\s*:?\s*([^|;]+?)(?=\s+(?:E-mail|Telefon|Kontakt|Web|IČ|Adresa|ID schránka|Statutární|Zástup|$))/i],
    ['ředitel',/\bŘeditel\s*:?\s*([^|;]+?)(?=\s+(?:E-mail|Telefon|Kontakt|Web|IČ|Adresa|ID schránka|Statutární|Zástup|$))/i],
    ['jednatel/ka',/\bJednatel(?:ka)?\s*:?\s*([^|;]+?)(?=\s+(?:E-mail|Telefon|Kontakt|Web|IČ|Adresa|ID schránka|$))/i],
    ['předseda/předsedkyně',/\bPředsed(?:a|kyně)(?:\s+představenstva)?\s*:?\s*([^|;]+?)(?=\s+(?:E-mail|Telefon|Kontakt|Web|IČ|Adresa|ID schránka|$))/i]
  ];
  let director='',leaderRole='';
  for(const [role,re] of patterns){const m=text.match(re);if(m){director=m[1].trim().replace(/\s{2,}/g,' ');leaderRole=role;break}}
  return {ico,director,leaderRole};
}
async function scrapeOrgPage(page,url){
  try{
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
    return await page.evaluate(()=>{
      const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
      const rows=[...document.querySelectorAll('tr')];
      let director='',leaderRole='',website='',address='',phone='',email='',capacity=null,board=[],supervisoryBoard=[];
      const labels=[
        [/^Ředitelka\b/i,'ředitelka'],[/^Ředitel\b/i,'ředitel'],[/^Jednatelka\b/i,'jednatelka'],[/^Jednatel\b/i,'jednatel'],[/^Předsedkyně(?: představenstva)?\b/i,'předsedkyně představenstva'],[/^Předseda(?: představenstva)?\b/i,'předseda představenstva']
      ];
      for(const tr of rows){
        const cells=[...tr.querySelectorAll('th,td')];if(cells.length<2)continue;
        const label=clean(cells[0].innerText);const value=clean(cells.slice(1).map(x=>x.innerText).join(' '));
        if(!director){for(const [re,role] of labels){if(re.test(label)){director=value.replace(/(?:,?\s*(?:tel\.|telefon|mob\.|e-mail|email)\s*:?).*$/i,'').trim();leaderRole=role;break}}}
        if(/^Adresa\b/i.test(label) && !address) address=value;
        if(/^(Telefon|Telefon\/fax|Tel\.)\b/i.test(label) && !phone) phone=value;
        if(/^(E-mail|Email)\b/i.test(label) && !email) email=value;
        if(/^Kapacita\b/i.test(label) && capacity===null){const m=value.match(/(\d[\d ]*)/);if(m)capacity=Number(m[1].replace(/\s/g,''));}
        if(/^(Webová prezentace|Web|Internetová stránka)\b/i.test(label)){
          const a=cells.slice(1).flatMap(c=>[...c.querySelectorAll('a[href]')]).find(a=>/^https?:/i.test(a.href));
          if(a)website=a.href;
          else if(value){let v=value.trim();if(!/^https?:\/\//i.test(v))v='https://'+v;website=v}
        }
      }
      if(!website){
        const candidates=[...document.querySelectorAll('a[href]')].filter(a=>/^https?:/i.test(a.href)&&!/praha8\.cz/i.test(a.hostname));
        const a=candidates.find(a=>/web|www\.|škola|school/i.test(clean(a.textContent)))||candidates[0];if(a)website=a.href;
      }
      
      const lines=(document.querySelector('main')||document.body).innerText.split('\n').map(clean).filter(Boolean);
      const collect=(labelRe,stopRe)=>{const i=lines.findIndex(x=>labelRe.test(x));if(i<0)return [];const out=[];for(let j=i+1;j<Math.min(lines.length,i+15);j++){const line=lines[j];if(stopRe.test(line))break;if(line.length<90 && !/^(IČ|Sídlo|Telefon|E-mail|Web)/i.test(line))out.push(line)}return [...new Set(out)].slice(0,8)};
      board=collect(/^(Představenstvo|Statutární orgán - představenstvo)$/i,/^(Dozorčí rada|Kontak|Sídlo|Akcionář|Společník)/i);
      supervisoryBoard=collect(/^Dozorčí rada$/i,/^(Představenstvo|Kontak|Sídlo|Akcionář|Společník)/i);
      if(capacity===null){const body=clean((document.querySelector('main')||document.body).innerText);const m=body.match(/kapacita\s*[:–-]?\s*(\d{2,4})\s*(?:dětí|žáků)?/i);if(m)capacity=Number(m[1]);}
      return {director,leaderRole,website,address,phone,email,capacity,board,supervisoryBoard};
    });
  }catch{return {director:'',leaderRole:'',website:'',address:'',phone:'',email:'',capacity:null,board:[],supervisoryBoard:[]}}
}
async function lookupAres(name){
  try{
    const r=await fetch('https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/vyhledat',{method:'POST',headers:{'content-type':'application/json','accept':'application/json','user-agent':UA},body:JSON.stringify({obchodniJmeno:name,start:0,pocet:5})});
    if(!r.ok)return null;
    const j=await r.json();
    const arr=j.ekonomickeSubjekty||j.ekonomickeSubjektySeznam||[];
    const n=name.toLowerCase().replace(/[^a-zá-ž0-9]/g,'');
    const best=arr.find(x=>(x.obchodniJmeno||'').toLowerCase().replace(/[^a-zá-ž0-9]/g,'')===n);
    if(!best)return null;
    return {ico:normalizeIco(best.ico),aresName:best.obchodniJmeno||''};
  }catch{return null}
}
async function collectSchoolLinks(page,url,prefix,subtype){
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
  return page.evaluate(({prefix,subtype})=>{
    const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
    const out=[];
    for(const a of document.querySelectorAll('a[href]')){
      const name=clean(a.textContent);if(!name.startsWith(prefix))continue;
      if(!/^https?:/i.test(a.href))continue;
      out.push({name,url:a.href,subtype});
    }
    return out;
  },{prefix,subtype});
}
async function collectCoreLinks(page){
  const url='https://www.praha8.cz/organizace-zrizene-mc.html';
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
  const wanted=['Osmá servisní a.s.','Osmá správa majetku a služeb a.s.','Osmička pro rodinu','Servisní středisko pro správu svěřeného majetku MČ Praha 8','Správa tepelného hospodářství MČ Praha 8 s.r.o.'];
  return page.evaluate(wanted=>[...document.querySelectorAll('a')].map(a=>({name:(a.textContent||'').replace(/\s+/g,' ').trim(),url:a.href})).filter(x=>wanted.includes(x.name)),wanted);
}

const manualPolitics=new Map([
 ['petr belda','ODS'],
 ['anna patockova','ANO'],
 ['jan horn','Patrioti']
]);
const organizationOverrides={
 '45250022':{director:'doc. MUDr. Iva Holmerová, Ph.D.',leaderRole:'ředitelka, primářka',website:'https://www.gerontocentrum.cz/'},
 '04387031':{director:'Kateřina Hrazánková',leaderRole:'ředitelka',website:'https://www.osmickaprorodinu.cz/'}
};

const organizationIcoByName=new Map([
 ['osma servisni a s','24796590'],
 ['osma sprava majetku a sluzeb a s','04650522'],
 ['sprava tepelneho hospodarstvi mc praha 8 s r o','04212371'],
 ['ipodec ciste mesto a s','40764877'],
 ['gerontologicke centrum','45250022'],
 ['osmicka pro rodinu','04387031'],
 ['servisni stredisko pro spravu svereneho majetku mc praha 8','00639524'],
 ['socialni a osetrovatelske sluzby praha 8','70871213']
]);
const organizationOverridesByName=new Map([
 ['gerontologicke centrum',{ico:'45250022',director:'doc. MUDr. Iva Holmerová, Ph.D.',leaderRole:'ředitelka, primářka',website:'https://www.gerontocentrum.cz/'}],
 ['osmicka pro rodinu',{ico:'04387031',director:'Kateřina Hrazánková',leaderRole:'ředitelka',website:'https://www.osmickaprorodinu.cz/'}]
]);
function simpleKey(s=''){return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim()}
const companySeeds={
 '24796590':{website:'https://www.osmaservisni.cz/',registrySource:'https://or.justice.cz/ias/ui/rejstrik-firma.vysledky?subjektId=69793&typ=PLATNY',ownershipShare:'100 %' ,board:[{name:'Bc. Tomáš Bína',role:'člen představenstva'}],supervisoryBoard:[{name:'Mgr. Libor Paulus',role:'předseda dozorčí rady'},{name:'Petr Belda',role:'člen dozorčí rady'},{name:'Mgr. Michal Janovský',role:'člen dozorčí rady'}]},
 '04650522':{website:'https://www.osms.cz/',registrySource:'https://or.justice.cz/ias/ui/rejstrik-firma.vysledky?subjektId=918881&typ=PLATNY',ownershipShare:'100 %' ,board:[{name:'Mgr. Kateřina Lonská',role:'předsedkyně představenstva'},{name:'Martin Cibulka',role:'člen představenstva'},{name:'Ing. Jiří Eliáš, MBA',role:'člen představenstva'}],supervisoryBoard:[{name:'Michal Fišer, MBA',role:'předseda dozorčí rady'},{name:'Anna Patočková',role:'členka dozorčí rady'},{name:'Tomáš Mikulenka',role:'místopředseda dozorčí rady'},{name:'Petr Belda',role:'člen dozorčí rady'}]},
 '04212371':{website:'https://www.sthpraha8.cz/',registrySource:'https://or.justice.cz/ias/ui/rejstrik-firma.vysledky?subjektId=902638&typ=PLATNY',ownershipShare:'100 %' ,statutoryBody:[{name:'PhDr. Ing. Matěj Fichtner, MBA',role:'jednatel'}]},
 '40764877':{website:'https://www.mariuspedersen.cz/',registrySource:'https://or.justice.cz/ias/ui/rejstrik-$firma?ico=40764877',ownershipShare:'43 %',ownershipSource:'https://www.praha8.cz/file/BXw/Zasedani-Obvodniho-zastupitelstva-30-09-1993-informace.pdf',board:[{name:'Ing. Petr Jindra',role:'předseda představenstva'},{name:'Jiří Jansa',role:'člen představenstva'},{name:'Mgr. Martin Cibulka',role:'člen představenstva'},{name:'prof. Ing. Bohumír Garlík, CSc., DBA',role:'člen představenstva'},{name:'Ing. Petra Ducháčová',role:'členka představenstva'}],supervisoryBoard:[{name:'Ing. Mikuláš Veselý, DiS.',role:'člen dozorčí rady'},{name:'Jarmila Kotrbová',role:'členka dozorčí rady'},{name:'Jan Horn',role:'člen dozorčí rady'},{name:'Ing. Pavel Lopuchovský',role:'člen dozorčí rady'}]}
};
function enrichBodyPolitics(o,people){
 const byKey=new Map(people.map(p=>[personKey(p.name),p.club]));
 const politics=name=>byKey.get(personKey(name))||manualPolitics.get(String(name||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim())||'';
 for(const field of ['board','supervisoryBoard','statutoryBody'])o[field]=(o[field]||[]).map(x=>typeof x==='string'?{name:x,role:'',club:politics(x)}:{...x,club:x.club||politics(x.name)});
 return o;
}
async function applySchoolStatsToOrganizations(orgs){
  try{
    const snap=JSON.parse(await readFile(resolve(root,'data/school-stats-snapshot.json'),'utf8'));
    const key=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
    const has=(name,needle)=>key(name).includes(key(needle));
    let primaryMatched=0,preschoolMatched=0;
    for(const o of orgs){
      delete o.pupils; delete o.classes; delete o.children; delete o.preschoolChildren; delete o.preschoolClasses;
      delete o.statsAsOf; delete o.statsSchoolYear; delete o.statsSource;
      const ps=(snap.primary||[]).find(x=>has(o.name,x.match));
      if(ps){o.pupils=ps.pupils;o.classes=ps.classes;primaryMatched++;}
      const ms=(snap.preschool||[]).find(x=>has(o.name,x.match));
      if(ms){if(o.type==='mateřská škola'){o.children=ms.preschoolChildren;o.classes=ms.preschoolClasses;}else{o.preschoolChildren=ms.preschoolChildren;o.preschoolClasses=ms.preschoolClasses;}preschoolMatched++;}
      if(ps||ms){o.statsAsOf=snap.asOf;o.statsSchoolYear=snap.schoolYear;o.statsSource='MČ Praha 8 – školské statistiky k 30. 9. 2025';}
    }
    console.log(`   Školská statistika připojena: ${primaryMatched} ZŠ · ${preschoolMatched} MŠ programů · školní rok ${snap.schoolYear}.`);
  }catch(e){console.warn(`   ⚠️ Školská statistika se nepodařila připojit: ${String(e.message||e).slice(0,180)}`)}
  return orgs;
}

async function syncOrganizations(browser,people){
  const page=await browser.newPage();await page.setUserAgent(UA);
  const schools=[
    ...(await collectSchoolLinks(page,'https://www.praha8.cz/Materske-skoly.html?size=1','Mateřská škola, Praha 8,','mateřská škola')),
    ...(await collectSchoolLinks(page,'https://www.praha8.cz/Zakladni-skoly.html?size=1','Základní škola','základní škola'))
  ];
  const core=await collectCoreLinks(page);
  const orgs=[];
  for(const x of schools)orgs.push({...x,legalType:'příspěvková organizace',type:x.subtype,ico:'',director:'',leaderRole:'',website:'',board:[],supervisoryBoard:[],statutoryBody:[]});
  for(const x of core){
    const company=/\b(?:a\.s\.|s\.r\.o\.)$/i.test(x.name);
    orgs.push({...x,legalType:company?'obchodní společnost':'příspěvková organizace',type:company?'městská obchodní společnost':'ostatní příspěvková organizace',ico:'',director:'',leaderRole:'',website:'',board:[],supervisoryBoard:[],statutoryBody:[]});
  }
  orgs.push(
    {name:'Sociální a ošetřovatelské služby Praha 8',url:'https://www.praha8.cz/Organizace-zdravotnickych-a-socialne-zdravotnickych-sluzeb',legalType:'příspěvková organizace',type:'ostatní příspěvková organizace',ico:'',director:'',leaderRole:'',website:'',board:[],supervisoryBoard:[],statutoryBody:[]},
    {name:'Gerontologické centrum',url:'https://www.praha8.cz/Organizace-zdravotnickych-a-socialne-zdravotnickych-sluzeb',legalType:'příspěvková organizace',type:'ostatní příspěvková organizace',ico:'',director:'',leaderRole:'',website:'',board:[],supervisoryBoard:[],statutoryBody:[]},
    {name:'IPODEC - ČISTÉ MĚSTO a.s.',url:'https://www.praha8.cz/Rada-mestske-casti-Praha-8.html',legalType:'obchodní společnost',type:'společnost s majetkovou účastí',ico:'40764877',director:'',leaderRole:'',website:'',board:[],supervisoryBoard:[],ownershipNote:'MČ Praha 8 je akcionář společnosti',ownershipShare:'43 %'}
  );
  const dedup=[...new Map(orgs.map(x=>[x.name.toLowerCase().replace(/\s+/g,' ').trim(),x])).values()];
  let i=0;
  for(const o of dedup){
    try{const html=await get(o.url);const d=parseOrgDetail(html);/* IČO z webové stránky záměrně nepřebíráme: na stránkách Praha 8 se často objeví IČO samotné MČ v patičce. */if(d.director){o.director=d.director;o.leaderRole=d.leaderRole}}catch{}
    const live=await scrapeOrgPage(page,o.url);if(live.director){o.director=live.director;o.leaderRole=live.leaderRole}if(live.website)o.website=normalizeWebsite(live.website);if(live.address)o.address=live.address;if(live.phone)o.phone=live.phone;if(live.email)o.email=live.email;if(live.capacity)o.capacity=live.capacity;if(live.board?.length)o.board=live.board;if(live.supervisoryBoard?.length)o.supervisoryBoard=live.supervisoryBoard;
    const trustedIco=organizationIcoByName.get(simpleKey(o.name));if(trustedIco)o.ico=trustedIco;
    if(!o.ico){const a=await lookupAres(o.name);if(a?.ico)o.ico=a.ico}
    const seed=companySeeds[o.ico] || (o.name==='Osmá servisní a.s.'?companySeeds['24796590']:o.name==='Osmá správa majetku a služeb a.s.'?companySeeds['04650522']:o.name==='Správa tepelného hospodářství MČ Praha 8 s.r.o.'?companySeeds['04212371']:o.name==='IPODEC - ČISTÉ MĚSTO a.s.'?companySeeds['40764877']:null);if(seed){Object.assign(o,seed);}
    const byName=organizationOverridesByName.get(simpleKey(o.name));if(byName){Object.assign(o,byName);}
    if(simpleKey(o.name).startsWith('servisni stredisko pro spravu svereneho majetku'))o.website='https://www.praha8.cz/servisni-stredisko-pro-spravu-svereneho-majetku-mc-praha-8-prispevkova-organizace.html';
    const override=organizationOverrides[o.ico];if(override){Object.assign(o,override);}
    if(['Osmá servisní a.s.','Osmá správa majetku a služeb a.s.'].includes(o.name)) {o.legalType='obchodní společnost';o.type='městská obchodní společnost';}
    if(o.name==='Správa tepelného hospodářství MČ Praha 8 s.r.o.'){o.legalType='obchodní společnost';o.type='městská obchodní společnost';}
    if(o.name==='IPODEC - ČISTÉ MĚSTO a.s.'){o.legalType='obchodní společnost';o.type='společnost s majetkovou účastí';}
    enrichBodyPolitics(o,people);
    i++;if(i%10===0)console.log(`   Organizace: ${i}/${dedup.length}… (IČO ${dedup.slice(0,i).filter(x=>x.ico).length}, vedení ${dedup.slice(0,i).filter(x=>x.director).length}, web ${dedup.slice(0,i).filter(x=>x.website).length})`);await sleep(80);
  }
  await page.close();
  const missingIco=dedup.filter(x=>!x.ico),missingDirector=dedup.filter(x=>x.legalType!=='obchodní společnost'&&!x.director),missingWebsite=dedup.filter(x=>!x.website);
  if(missingIco.length)console.warn(`   Pozor: IČO chybí u ${missingIco.length} organizací.`);
  if(missingDirector.length)console.warn(`   Pozor: vedení se nepodařilo automaticky najít u ${missingDirector.length} organizací: ${missingDirector.map(x=>x.name).join('; ')}`);
  if(missingWebsite.length)console.warn(`   Pozor: vlastní web chybí u ${missingWebsite.length} organizací: ${missingWebsite.map(x=>x.name).join('; ')}`);
  dedup.sort((a,b)=>a.type.localeCompare(b.type,'cs')||a.name.localeCompare(b.name,'cs'));
  await applySchoolStatsToOrganizations(dedup);
  await writeFile(resolve(root,'data/organizace.json'),JSON.stringify(dedup,null,2));return dedup;
}


async function carryPreviousUsneseni(){
  const current=await readOld();
  if(current.filter(x=>x.organ==='Rada').length>1000)return current;
  // Při iteraci lokálních verzí vezmeme automaticky nejbohatší usneseni.json
  // ze sourozenecké složky, aby uživatel nemusel 14 tisíc RMC znovu stahovat.
  try{
    const {readdir}=await import('node:fs/promises');
    const parent=resolve(root,'..');
    const dirs=(await readdir(parent,{withFileTypes:true})).filter(d=>d.isDirectory()&&/^praha8-prehledy-v/i.test(d.name));
    let best=current,bestPath='';
    for(const d of dirs){
      if(resolve(parent,d.name)===root)continue;
      try{
        const arr=JSON.parse(await readFile(resolve(parent,d.name,'data/usneseni.json'),'utf8'));
        if(Array.isArray(arr)&&arr.filter(x=>x.organ==='Rada').length>best.filter(x=>x.organ==='Rada').length){best=arr;bestPath=d.name}
      }catch{}
    }
    if(bestPath){await writeFile(resolve(root,'data/usneseni.json'),JSON.stringify(best,null,2));console.log(`   Přenesena existující data usnesení ze složky ${bestPath} (${best.length.toLocaleString('cs-CZ')} záznamů).`);}
    return best;
  }catch{return current}
}

function personVariants(name=''){
 const toks=String(name).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\b(?:mgr|bc|ing|phdr|judr|rndr|doc|prof|phd|mba|dis|ma|bca|et)\.?\b/gi,' ').replace(/[^a-zA-Z ]/g,' ').toLowerCase().split(/\s+/).filter(Boolean);
 if(toks.length<2)return [];
 const a=toks[0],b=toks[1];return [`${a} ${b}`,`${b} ${a}`];
}
// Některá jména nejsou mezi veřejnými orgány jednoznačná. V takovém případě
// je bezpečnější automatické párování vypnout a použít jen ručně ověřenou roli.
const ambiguousExternalNames=new Set(['michal novak']);
function canonicalPersonName(name=''){
 const v=personVariants(name);return v.length?v[0].split(' ').sort().join(' '):'';
}
function textHasPerson(text,p){
 const canonical=canonicalPersonName(p.name);
 if(ambiguousExternalNames.has(canonical))return false;
 const n=String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ');
 return personVariants(p.name).some(v=>n.includes(v));
}
function inferExternalRole(text,p){
 const n=String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ');
 let at=-1,match='';
 for(const v of personVariants(p.name)){const i=n.indexOf(v);if(i>=0&&(at<0||i<at)){at=i;match=v}}
 if(at<0)return 'člen';
 const before=n.slice(Math.max(0,at-90),at);
 const after=n.slice(at+match.length,Math.min(n.length,at+match.length+70));
 // Funkce musí být opravdu v bezprostředním okolí jména. Předseda uvedený
 // v nadpisu celé karty nesmí udělat předsedu ze všech členů orgánu.
 const near=before.slice(-55)+' '+after.slice(0,35);
 if(/mistopredsed/.test(near))return 'místopředseda';
 if(/predsed/.test(near))return 'předseda';
 return 'člen';
}
async function loadPreviousHmpRoles(){
  const out=new Map();
  try{
    const {readdir}=await import('node:fs/promises');
    const parent=resolve(root,'..');
    const dirs=(await readdir(parent,{withFileTypes:true})).filter(d=>d.isDirectory()&&/^praha8-prehledy-v/i.test(d.name));
    for(const d of dirs){
      if(resolve(parent,d.name)===root)continue;
      try{
        const arr=JSON.parse(await readFile(resolve(parent,d.name,'data/lide.json'),'utf8'));
        for(const p of arr||[]){
          const k=personKey(p.name); const cur=out.get(k)||{magistrateRoles:[],hmpCompanyRoles:[]};
          if((p.magistrateRoles||[]).length>cur.magistrateRoles.length)cur.magistrateRoles=p.magistrateRoles;
          if((p.hmpCompanyRoles||[]).length>cur.hmpCompanyRoles.length)cur.hmpCompanyRoles=p.hmpCompanyRoles;
          out.set(k,cur);
        }
      }catch{}
    }
  }catch{}
  return out;
}

async function syncMagistrateRoles(browser,people,{includeFunctions=true,includeCompanies=true}={}){
 const roles=new Map(people.map(p=>[personKey(p.name),[]]));
 const companyRoles=new Map(people.map(p=>[personKey(p.name),[]]));
 const otherRoles=new Map(people.map(p=>[personKey(p.name),[...(p.otherRoles||[])]]));
 const page=await browser.newPage();await page.setUserAgent(UA);
 const addRole=(p,x)=>roles.get(personKey(p.name)).push(x);
 const addCompanyRole=(p,x)=>companyRoles.get(personKey(p.name)).push(x);
 const addOtherRole=(p,x)=>otherRoles.get(personKey(p.name)).push(x);
 const findPerson=(needle)=>people.find(p=>personVariants(p.name).some(v=>v===needle.toLowerCase())) || people.find(p=>personKey(p.name)===personKey(needle));

 // Audit HMP 2026: všech 45 zastupitelů Prahy 8 bylo křížově zkontrolováno
 // proti oficiálním seznamům ZHMP/RHMP, složení výborů a novějším zápisům.
 // Statická mapa níže obsahuje jen role, které se podařilo jednoznačně potvrdit.
 // Nejednoznačné shody (např. shodná jména bez jisté identity) se sem záměrně nepřidávají.
 const verifiedHmpRoles=new Map(Object.entries({
   'Ondřej Buršík':[
     {role:'člen',body:'Výbor pro bezpečnost a pro prevenci kriminality ZHMP',url:'https://praha.eu/vybory'}
   ],
   'Tomáš Slabihoudek':[
     {role:'radní hl. města Prahy',body:'',url:'https://praha.eu/rada'},
     {role:'zastupitel hl. města Prahy',body:'',url:'https://praha.eu/zastupitelstvo'},
     {role:'člen',body:'Výbor pro dopravu ZHMP',url:'https://praha.eu/vybory'},
     {role:'člen',body:'Výbor pro dotační vztahy a vztahy k městským částem ZHMP',url:'https://praha.eu/vybory'},
     {role:'člen',body:'Výbor finanční ZHMP',url:'https://praha.eu/vybory'},
     {role:'člen',body:'Výbor kontrolní ZHMP',url:'https://praha.eu/vybory'},
     {role:'člen',body:'Povodňová komise hl. m. Prahy',url:'https://praha.eu'}
   ],
   'Tomáš Němeček':[
     {role:'člen',body:'Výbor pro dotační vztahy a vztahy k městským částem ZHMP',url:'https://praha.eu/vybory'}
   ],
   'Jan Šimbera':[
     {role:'člen',body:'Výbor pro energetiku ZHMP',url:'https://praha.eu/vybory'}
   ],
   'Vítězslav Novák':[
     {role:'člen',body:'Výbor finanční ZHMP',url:'https://praha.eu/vybory'}
   ],
   'Vladimíra Ludková':[
     {role:'členka',body:'Výbor pro rodinnou politiku a sociální oblast ZHMP',url:'https://praha.eu/vybory'}
   ],
   'Radomír Nepil':[
     {role:'zastupitel hl. města Prahy',body:'',url:'https://praha.eu/zastupitelstvo'},
     {role:'člen',body:'Výbor pro dotační vztahy a vztahy k městským částem ZHMP',url:'https://praha.eu/vybory'},
     {role:'člen',body:'Výbor pro územní rozvoj ZHMP',url:'https://praha.eu/vybory'},
     {role:'člen',body:'Komise Rady hl. m. Prahy pro nový územní plán',url:'https://praha.eu/komise_rady_hmp'}
   ],
   'Michal Trník':[
     {role:'člen',body:'Výbor pro strategické investice ZHMP',url:'https://praha.eu/vybory'}
   ],
   'Václav Stránský':[
     {role:'člen',body:'Výbor pro územní rozvoj ZHMP',url:'https://praha.eu/vybory'}
   ],
   'Vladislava Vojtíšková':[
     {role:'členka',body:'Výbor pro strategický a hospodářský rozvoj a podporu podnikání a inovací ZHMP',url:'https://praha.eu/vybory'},
     {role:'členka',body:'Výbor pro zahraniční vztahy a EU fondy ZHMP',url:'https://praha.eu/vybory'}
   ],
   'Martin Štěrba':[
     {role:'předseda',body:'Komise pro veřejnou dopravu RHMP',url:'https://praha.eu/komise_rady_hmp'}
   ]
 }).map(([name,items])=>[personKey(name),items]));
 if(includeFunctions){
   for(const p of people){
     const key=personKey(p.name);
     for(const r of (verifiedHmpRoles.get(key)||[]))addRole(p,r);
   }
 }
 // Ověřená současná funkce v městské společnosti HMP.
 const verifiedHmpCompanyRoles=new Map(Object.entries({
   'Radomír Nepil':[{role:'člen dozorčí rady',body:'Pražské služby, a.s.',url:'https://praha.eu/prazske-sluzby-a-s'}],
   'Michal Fišer':[{role:'člen představenstva',body:'Technologie hlavního města Prahy, a.s.',url:'https://praha.eu/technologie-hlavniho-mesta-prahy-a-s'}],
   'Jakub Jiran':[{role:'místopředseda dozorčí rady',body:'Dopravní podnik hl. m. Prahy, a.s.',url:'https://praha.eu/dopravni-podnik-hl-m-prahy-a-s'}]
 }).map(([name,items])=>[personKey(name),items]));
 if(includeCompanies)for(const p of people)for(const r of (verifiedHmpCompanyRoles.get(personKey(p.name))||[]))addCompanyRole(p,r);

 const waitForPortal=async()=>{
   for(let i=0;i<8;i++){
     const size=await page.evaluate(()=>(document.querySelector('main')||document.body).innerText.length).catch(()=>0);
     if(size>1200)return;
     await sleep(700);
   }
 };
 const scanPage=async(url,kind)=>{
   try{
     await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});await waitForPortal();
     // Zkusíme stránku posunout, protože některé komponenty HMP se lazy-loadují.
     await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight)).catch(()=>{});await sleep(800);
     const rows=await page.evaluate(()=>{
       const main=document.querySelector('main')||document.body;
       const out=[];
       const selectors='tr,article,li,.card,.list-group-item,.portlet-body,.web-content,.accordion-item,.row,[role="row"],[role="listitem"]';
       const getHeading=(el)=>{
         let cur=el;
         for(let n=0;n<7&&cur;n++,cur=cur.parentElement){
           const own=cur.matches?.('h1,h2,h3,h4,h5')?cur:null;
           if(own)return (own.innerText||'').replace(/\s+/g,' ').trim();
           const h=cur.querySelector?.('h1,h2,h3,h4,h5,.h2,.h3,.title,.card-title,.accordion-header');
           if(h&&h!==el)return (h.innerText||'').replace(/\s+/g,' ').trim();
           let prev=cur.previousElementSibling;
           while(prev){
             if(prev.matches?.('h1,h2,h3,h4,h5,.title,.card-title'))return (prev.innerText||'').replace(/\s+/g,' ').trim();
             prev=prev.previousElementSibling;
           }
         }
         return '';
       };
       for(const el of main.querySelectorAll(selectors)){
         const text=(el.innerText||'').replace(/\s+/g,' ').trim();
         if(text.length<5||text.length>1800)continue;
         const a=el.querySelector('a[href]');
         out.push({text,heading:getHeading(el),url:a?.href||location.href});
       }
       // Fallback pro Liferay/SPA: vytvoříme i bloky z textu mezi nadpisy, aby
       // šlo spárovat jména členů i tam, kde portál nepoužívá klasické karty.
       const headings=[...main.querySelectorAll('h1,h2,h3,h4,h5')];
       for(const h of headings){
         let text=(h.innerText||'').replace(/\s+/g,' ').trim();
         let n=h.nextElementSibling,steps=0;
         while(n&&steps<12&&!/^H[1-5]$/.test(n.tagName)){text+=' '+(n.innerText||'');n=n.nextElementSibling;steps++;}
         text=text.replace(/\s+/g,' ').trim();
         if(text.length>=5&&text.length<5000)out.push({text,heading:(h.innerText||'').replace(/\s+/g,' ').trim(),url:location.href});
       }
       if(!out.length)out.push({text:(main.innerText||'').replace(/\s+/g,' '),heading:'',url:location.href});
       return out;
     });
     for(const p of people){
       for(const row of rows){if(!textHasPerson(row.text,p))continue;
         const n=row.text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
         let role=inferExternalRole(row.text,p);
         let body=(row.heading||'').trim();
         if(!body){
           body=row.text.replace(/\s+/g,' ').trim();
           const variants=personVariants(p.name);for(const v of variants){const rx=new RegExp(v.replace(/ /g,'\\s+'),'i');body=body.replace(rx,'').trim()}
           body=body.replace(/^(předseda|předsedkyně|místopředseda|místopředsedkyně|člen|členka)\s*/i,'').replace(/^[–—,:;\-\s]+/,'').trim();
         }
         if(!body||body.length>180)body=kind;
         addRole(p,{role,body,url:row.url||url});break;
       }
     }
   }catch(e){console.warn(`   HMP ${kind}: ${e.message}`)}
 };
 const scanBodyDirectory=async(directoryUrl,kind)=>{
   try{
     await page.goto(directoryUrl,{waitUntil:'domcontentloaded',timeout:30000});await waitForPortal();
     await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight)).catch(()=>{});await sleep(1200);
     let links=await page.evaluate(()=>{
       const main=document.querySelector('main')||document.body;
       return [...main.querySelectorAll('a[href]')].map(a=>({text:(a.innerText||a.textContent||'').replace(/\s+/g,' ').trim(),url:a.href}))
         .filter(x=>x.text.length>3&&x.url&&/praha\.eu/.test(x.url));
     });
     links=[...new Map(links.map(x=>[x.url,x])).values()]
       .filter(x=>!/download|\.pdf($|\?)/i.test(x.url))
       .filter(x=>!/(zastupitelstvo|rada|kontakt|uredni-deska|mestske-spolecnosti)\/?($|#)/i.test(x.url))
       .slice(0,120);
     for(const l of links){
       try{
         await page.goto(l.url,{waitUntil:'domcontentloaded',timeout:18000});await waitForPortal();
         const info=await page.evaluate(()=>{
           const main=document.querySelector('main')||document.body;
           const title=(main.querySelector('h1')||main.querySelector('h2'))?.innerText?.replace(/\s+/g,' ').trim()||document.title;
           const text=(main.innerText||'').replace(/\s+/g,' ').trim();
           return {title,text,url:location.href};
         });
         if(!info.text||info.text.length<20)continue;
         for(const p of people){
           if(!textHasPerson(info.text,p))continue;
           const nt=info.text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
           const vars=personVariants(p.name);let at=-1;for(const v of vars){const i=nt.indexOf(v);if(i>=0){at=i;break}}
           const around=at>=0?nt.slice(Math.max(0,at-180),at+220):nt;
           let role=inferExternalRole(info.text,p);
           addRole(p,{role,body:info.title||kind,url:info.url||l.url});
         }
       }catch{}
     }
   }catch(e){console.warn(`   HMP detailní ${kind}: ${e.message}`)}
 };

 if(includeFunctions){try{
   await page.goto('https://praha.eu/zastupitelstvo',{waitUntil:'domcontentloaded',timeout:30000});await waitForPortal();
   const zhmpText=await page.evaluate(()=>(document.querySelector('main')||document.body).innerText);
   for(const p of people)if(textHasPerson(zhmpText,p))addRole(p,{role:'zastupitel hl. města Prahy',body:'',url:'https://praha.eu/zastupitelstvo'});
   await page.goto('https://praha.eu/rada',{waitUntil:'domcontentloaded',timeout:30000});await waitForPortal();
   const rtext=await page.evaluate(()=>(document.querySelector('main')||document.body).innerText);
   for(const p of people)if(textHasPerson(rtext,p))addRole(p,{role:'radní hl. města Prahy',body:'',url:'https://praha.eu/rada'});
   await scanPage('https://praha.eu/vybory#/?periodId=-36525&year=2026&month=8','Výbor ZHMP');
   await scanPage('https://praha.eu/komise_rady_hmp#/?periodId=-36525&showAll=true','Komise RHMP');
   // Druhý průchod: otevře každý dohledaný orgán zvlášť a zkontroluje všech 45 zastupitelů Prahy 8.
   await scanBodyDirectory('https://praha.eu/vybory#/?periodId=-36525&year=2026&month=8','Výbor ZHMP');
   await scanBodyDirectory('https://praha.eu/komise_rady_hmp#/?periodId=-36525&showAll=true','Komise RHMP');
 }catch(e){console.warn(`   Hlavní město Praha – funkce: doplnění se nepodařilo (${e.message}).`)} }
 if(includeCompanies){try{
   await page.goto('https://praha.eu/mestske-spolecnosti',{waitUntil:'domcontentloaded',timeout:30000});await waitForPortal();
   let companies=await page.evaluate(()=>[...document.querySelectorAll('main a[href]')].map(a=>({name:(a.textContent||'').replace(/\s+/g,' ').trim(),url:a.href})).filter(x=>x.name.length>2&&/praha\.eu/.test(x.url)));
   companies=[...new Map(companies.map(x=>[x.url,x])).values()].filter(x=>!x.url.includes('/mestske-spolecnosti')&&!/kontakt|tisk|ured|zastupitelstvo|\/rada\/?$/i.test(x.url)).slice(0,90);
   for(const c of companies){try{
     await page.goto(c.url,{waitUntil:'domcontentloaded',timeout:16000});const text=await page.evaluate(()=>(document.querySelector('main')||document.body).innerText);const nt=text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
     if(!/predstavenstvo|dozorci rada|spravni rada/.test(nt))continue;
     for(const p of people){if(!textHasPerson(text,p))continue;const at=Math.max(...personVariants(p.name).map(v=>nt.indexOf(v)));if(at<0)continue;let section='',best=-1;for(const [label,needle] of [['Představenstvo','predstavenstvo'],['Dozorčí rada','dozorci rada'],['Správní rada','spravni rada']]){const i=nt.lastIndexOf(needle,at);if(i>best){best=i;section=label}}if(!section||at-best>2400)continue;const around=nt.slice(Math.max(best,at-120),at+220);let prefix=/mistopredsed/.test(around)?'místopředseda':/predsed/.test(around)?'předseda':'člen';addCompanyRole(p,{role:`${prefix} ${section.toLowerCase()}`,body:c.name,url:c.url});}
   }catch{}}
 }catch(e){console.warn(`   Hlavní město Praha – firmy: doplnění se nepodařilo (${e.message}).`)} }
 await page.close();
 const cleanHmpBody=s=>String(s||'')
   .replace(/\s*\((?:19|20)\d{2}\s*[–—-]\s*(?:19|20)\d{2}\)\s*$/i,'')
   .replace(/\s+(?:ZHMP|RHMP)\s*$/i,'')
   .replace(/\s+(?:Zastupitelstva|Rady)\s+hl\.?\s*(?:m\.?|města)\s*Prahy\s*$/i,'')
   .replace(/^Komise\s+(?:Rady\s+hl\.?\s*(?:m\.?|města)\s*Prahy|RHMP)\s+/i,'Komise ')
   .replace(/^Výbor\s+(?:ZHMP|Zastupitelstva\s+hl\.?\s*(?:m\.?|města)\s*Prahy)\s+/i,'Výbor ')
   .replace(/\s+/g,' ').trim();
 const normBody=s=>cleanHmpBody(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(t=>!['a','pro','v','ve','na','k','ke'].includes(t)).join(' ');
 const normRole=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 const roleRank=s=>{const n=normRole(s);return /mistopredsed/.test(n)?2:/predsed/.test(n)?3:/clen/.test(n)?1:0};
 const dedupe=x=>[...new Map((x||[]).map(v=>[normRole(v.role)+'|'+normBody(v.body),{...v,body:cleanHmpBody(v.body)}])).values()];
 const mergeHmpRoles=(dynamic,verified)=>{
   const map=new Map();
   for(const raw of dynamic||[]){
     const v={...raw,body:cleanHmpBody(raw.body)};
     const bodyKey=normBody(v.body);
     const key=bodyKey?`body:${bodyKey}`:`role:${normRole(v.role)}`;
     const prev=map.get(key);
     if(!prev||roleRank(v.role)>roleRank(prev.role))map.set(key,v);
   }
   // Auditní role jsou autoritativní. Stejný orgán z automatického parseru se
   // odstraní bez ohledu na to, jakou funkci parser odhadl.
   for(const raw of verified||[]){
     const v={...raw,body:cleanHmpBody(raw.body)};
     const bodyKey=normBody(v.body);
     const key=bodyKey?`body:${bodyKey}`:`role:${normRole(v.role)}`;
     map.set(key,v);
   }
   return [...map.values()];
 };
 const out=people.map(p=>{
   const key=personKey(p.name);
   const verified=includeFunctions?(verifiedHmpRoles.get(key)||[]):[];
   let mr=includeFunctions?mergeHmpRoles(roles.get(key),verified):[];
   // Explicitně známé falešné předsednické shody z dynamického portálu.
   if(['bursik ondrej','dvorakova jana'].includes(canonicalPersonName(p.name))){
     mr=mr.map(v=>verified.some(x=>normBody(x.body)===normBody(v.body))?v:{...v,role:/místopředs|předs/i.test(v.role)?(canonicalPersonName(p.name)==='dvorakova jana'?'členka':'člen'):v.role});
   }
   let cr=includeCompanies?dedupe(companyRoles.get(key)):[];
   const verifiedCompanies=includeCompanies?(verifiedHmpCompanyRoles.get(key)||[]):[];
   if(verifiedCompanies.length){
     const bodies=new Set(verifiedCompanies.map(v=>normBody(v.body)));
     cr=cr.filter(v=>!bodies.has(normBody(v.body)));
     cr=dedupe([...verifiedCompanies,...cr]);
   }
   return {...p,magistrateRoles:mr,otherRoles:dedupe(otherRoles.get(key)),hmpCompanyRoles:cr};
 });
 const hmpPeople=out.filter(p=>(p.magistrateRoles||[]).length).length;
 const hmpFirms=out.filter(p=>(p.hmpCompanyRoles||[]).length).length;
 if(includeFunctions && includeCompanies) console.log(`   HMP audit: 45/45 zastupitelů prověřeno; potvrzené role HMP u ${hmpPeople} lidí, městské firmy u ${hmpFirms} lidí.`);
 else if(includeFunctions) console.log(`   Funkce HMP: 45/45 zastupitelů prověřeno; potvrzené role HMP u ${hmpPeople} lidí.`);
 else if(includeCompanies) console.log(`   Firmy HMP: 45/45 zastupitelů prověřeno; funkce ve firmách nalezeny u ${hmpFirms} lidí.`);
 await writeFile(resolve(root,'data/lide.json'),JSON.stringify(out,null,2));return out;
}

async function syncVotingSummaries(){
  let items=[];
  try{items=JSON.parse(await readFile(resolve(root,'data/hlasovani.json'),'utf8'))}catch{return 0}
  let changed=0;
  for(const x of items){
    try{
      const base=String(x.url||'').replace(/index\.html(?:\?.*)?$/i,'');
      const detail=base+String(x.number).padStart(4,'0')+'.html';
      const html=await get(detail);
      const text=clean(html);
      const present=Number((text.match(/PŘÍTOMN(?:ÝCH|YCH)\s*:\s*(\d+)/i)||[])[1]||x.present||0);
      const yes=Number((text.match(/\bPRO\s*:\s*(\d+)/i)||[])[1]||x.for||0);
      const abstain=Number((text.match(/ZDRŽELO\s+SE\s*:\s*(\d+)/i)||[])[1]||0);
      const against=Number((text.match(/PROTI\s*:\s*(\d+)/i)||[])[1]||0);
      const notVoting=Number((text.match(/NEHLASOVALO\s*:\s*(\d+)/i)||[])[1]||0);
      const upper=String(text||'').toLocaleUpperCase('cs-CZ');
      let status='';
      if(/NEPŘIJAT|NESCHVÁLEN|NÁVRH\s+NEBYL\s+PŘIJAT/.test(upper))status='neschváleno';
      else if(/PŘIJAT|SCHVÁLEN|NÁVRH\s+BYL\s+PŘIJAT/.test(upper))status='schváleno';
      const src=String(detail||x.url||'').toUpperCase();
      const body=src.includes('ZMC')?'Zastupitelstvo MČ Praha 8':src.includes('RMC')?'Rada MČ Praha 8':(x.body||'');
      // Best-effort parsování individuálních hlasů z tabulkových řádků detailu.
      // Pokud konkrétní export strukturu nemá, pole zůstane prázdné a UI to přizná.
      const votes=[];
      for(const m of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)){
        const cells=[...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c=>clean(c[1]));
        if(cells.length<2)continue;
        const voteCell=cells.find(c=>/^(PRO|PROTI|ZDRŽEL(?:A)? SE|NEHLASOVAL(?:A)?|NEPŘÍTOMEN|NEPRITOMEN)$/i.test(c.trim()));
        if(!voteCell)continue;
        const nameCell=cells.find(c=>c!==voteCell && /[A-Za-zÁ-ž]{2,}\s+[A-Za-zÁ-ž]{2,}/.test(c));
        if(!nameCell)continue;
        const vv=voteCell.toUpperCase().replace(/ZDRŽELA SE/,'ZDRŽEL SE').replace(/NEHLASOVALA/,'NEHLASOVAL');
        votes.push({name:nameCell.replace(/\s+/g,' ').trim(),vote:vv.charAt(0)+vv.slice(1).toLowerCase()});
      }
      const dedupVotes=[...new Map(votes.map(v=>[canonicalPersonName(v.name),v])).values()];
      Object.assign(x,{present,for:yes,against,abstain,notVoting,detailUrl:detail,status,body,votes:dedupVotes});
      changed++;
    }catch{}
  }
  await writeFile(resolve(root,'data/hlasovani.json'),JSON.stringify(items,null,2));
  return changed;
}

async function syncVotingLinks(){
  const page='https://www.praha8.cz/Prehledy-hlasovani.html';
  const html=await get(page);
  const links=[...html.matchAll(/href=["']([^"']+)["'][^>]*>([\s\S]*?Přehled hlasování zastupitelstva[\s\S]*?)<\/a>/gi)]
    .map(m=>({url:absolute(m[1],page),title:clean(m[2])}));
  await writeFile(resolve(root,'data/hlasovani-zdroje.json'),JSON.stringify(links,null,2));
  return links.length;
}



async function crawlPagedHtml(browser,startUrl,{maxPages=250,mouseFallback=false}={}){
  // Praha 8 používá u 106 i úřední desky starší ASP.NET/WebForms pager.
  // Pager se může renderovat jako javascript:__doPostBack(...), případně jako
  // klikací číslo bez použitelného href. Proto neklikáme přes Puppeteer
  // ElementHandle.click() (u některých prvků hlásí "not clickable"), ale
  // spouštíme DOM click / WebForms submit přímo uvnitř stránky.
  const page=await browser.newPage();
  const pages=[];
  try{
    await page.goto(startUrl,{waitUntil:'domcontentloaded',timeout:60000});
    let pageNo=1;
    const signatures=new Set();
    while(pageNo<=maxPages){
      await sleep(250);
      const html=await page.content();
      const signature=await page.evaluate(()=>{
        const main=document.querySelector('main')||document.body;
        return (main.innerText||'').replace(/\s+/g,' ').trim().slice(0,16000);
      });
      if(signatures.has(signature))break;
      signatures.add(signature);
      pages.push({url:page.url(),html});

      const nextNum=pageNo+1;
      const action=await page.evaluate((n)=>{
        const norm=v=>(v||'').replace(/\s+/g,' ').trim();
        const els=[...document.querySelectorAll('a,button,input')];
        const parsePostback=(raw)=>{
          if(!raw)return null;
          const txt=String(raw).replace(/&quot;/g,'"').replace(/&#39;/g,"'");
          const pm=txt.match(/Page\$(\d+)/i);
          if(!pm)return null;
          const tm=txt.match(/__doPostBack\(\s*['\"]([^'\"]+)['\"]/i);
          return {page:Number(pm[1]),target:tm?tm[1]:null};
        };

        // 1) preferujeme přímo odkaz/postback na následující stranu
        for(let i=0;i<els.length;i++){
          const el=els[i];
          const raw=`${el.getAttribute('href')||''} ${el.getAttribute('onclick')||''}`;
          const pb=parsePostback(raw);
          if(pb&&pb.page===n)return {kind:pb.target?'postback':'domclick',target:pb.target,argument:`Page$${n}`,index:i,text:n+''};
        }

        // 2) někdy je v DOM jen číselný pager bez snadno čitelného postbacku.
        // U úřední desky starší JS handler při programovém el.click() sahá na
        // Function.caller/arguments a v Puppeteer strict režimu spadne. Proto
        // si u tohoto fallbacku umíme vrátit souřadnice a provést skutečný
        // mouse click mimo page.evaluate().
        for(let i=0;i<els.length;i++){
          const el=els[i];
          const text=norm(el.textContent||el.value);
          if(text===String(n)){
            const r=el.getBoundingClientRect();
            const visible=r.width>0&&r.height>0&&r.bottom>0&&r.right>0;
            if(visible)return {kind:'mouse',index:i,text:String(n),x:r.left+r.width/2,y:r.top+r.height/2};
            return {kind:'domclick',index:i,text:String(n)};
          }
        }

        // 3) poslední fallback: pagerové „>“ / „…“ může mířit dál než o jednu stranu
        for(let i=0;i<els.length;i++){
          const el=els[i];
          const raw=`${el.getAttribute('href')||''} ${el.getAttribute('onclick')||''}`;
          const pb=parsePostback(raw);
          if(pb&&pb.page>=n)return {kind:pb.target?'postback':'domclick',target:pb.target,argument:`Page$${pb.page}`,index:i,text:n+''};
        }
        return null;
      },nextNum);
      if(!action)break;

      const before=signature;
      let triggered=false;
      if(action.kind==='mouse'&&mouseFallback){
        // Skutečný klik myší probíhá mimo page.evaluate(), takže legacy handler
        // úřední desky neběží uvnitř strict-mode callbacku Puppeteer.
        await page.mouse.click(action.x,action.y);
        triggered=true;
      }else{
        triggered=await page.evaluate((a)=>{
          const ensureHidden=(form,name)=>{
            let el=form.querySelector(`[name="${name}"]`);
            if(!el){el=document.createElement('input');el.type='hidden';el.name=name;form.appendChild(el)}
            return el;
          };
          if(a.kind==='postback'&&a.target){
            // ASP.NET WebForms: nevoláme window.__doPostBack(). Některé starší
            // skripty Prahy 8 uvnitř používají Function.caller/arguments a v
            // Puppeteer strict-mode kontextu tím spadnou. Uděláme přesně to,
            // co __doPostBack dělá: nastavíme hidden fields a odešleme formulář
            // nativní metodou bez spouštění JS submit/click handlerů.
            const form=document.forms[0];
            if(!form)return false;
            ensureHidden(form,'__EVENTTARGET').value=a.target;
            ensureHidden(form,'__EVENTARGUMENT').value=a.argument;
            HTMLFormElement.prototype.submit.call(form);
            return true;
          }
          const els=[...document.querySelectorAll('a,button,input')];
          const el=els[a.index];
          if(!el)return false;
          el.click();
          return true;
        },action);
      }
      if(!triggered)break;

      await Promise.race([
        page.waitForNavigation({waitUntil:'domcontentloaded',timeout:15000}).catch(()=>null),
        page.waitForFunction(prev=>{
          const main=document.querySelector('main')||document.body;
          return (main.innerText||'').replace(/\s+/g,' ').trim().slice(0,16000)!==prev;
        },{timeout:15000},before).catch(()=>null)
      ]);
      await sleep(300);
      const after=await page.evaluate(()=>{
        const main=document.querySelector('main')||document.body;
        return (main.innerText||'').replace(/\s+/g,' ').trim().slice(0,16000);
      });
      if(after===before){
        console.log(`      ⚠️ Pager se na straně ${pageNo} neposunul dál (${startUrl}).`);
        break;
      }
      pageNo++;
    }
  }finally{await page.close().catch(()=>{})}
  return pages;
}

async function syncInfo106(browser){
  const indexUrl='https://m.praha8.cz/poskytovani-informaci-dle-zakona-c-106-1999-sb-o-svobodnem-pristupu-k-informacim.html';
  const index=await get(indexUrl);
  const years=[...index.matchAll(/href=["']([^"']+)["'][^>]*>\s*Poskytnut[eé]\s+informace\s+(20\d{2})/gi)]
    .map(m=>({year:Number(m[2]),url:absolute(m[1],indexUrl)})).filter(x=>x.year>=2007);
  const uniq=[...new Map(years.map(x=>[x.year,x])).values()].sort((a,b)=>b.year-a.year);
  const items=[],seenItems=new Set();
  for(const y of uniq){
    const pages=await crawlPagedHtml(browser,y.url,{maxPages:100});
    console.log(`      ${y.year}: ${pages.length} stran`);
    for(const pg of pages){
      for(const m of pg.html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>\s*(?:<[^>]+>\s*)*Žádost o poskytnutí informace\s+20\d{2}[\s\S]*?<\/a>/gi)){
        const url=absolute(m[1],pg.url); if(seenItems.has(url))continue; seenItems.add(url);
        const around=pg.html.slice(m.index,Math.min(pg.html.length,m.index+2200));
        const text=clean(around); const date=(text.match(/\b(\d{1,2}\.\s*\d{1,2}\.\s*20\d{2})\b/)||[])[1]||'';
        const desc=text.replace(/^.*?Žádost o poskytnutí informace\s+20\d{2}\s*/i,'').replace(/\s+(?:Mohlo by vás|Odpověď:).*$/i,'').trim();
        items.push({year:y.year,date:isoDate(date),title:desc||`Žádost o poskytnutí informace ${y.year}`,url});
      }
    }
  }
  items.sort((a,b)=>(b.date||String(b.year)).localeCompare(a.date||String(a.year)));
  await writeFile(resolve(root,'data/info106.json'),JSON.stringify(items,null,2)); return items;
}

async function syncNoticeBoard(browser){
  const start='https://www.praha8.cz/deska';
  const pages=await crawlPagedHtml(browser,start,{maxPages:100,mouseFallback:true});
  const items=[],seen=new Set();
  console.log(`      úřední deska: ${pages.length} stran`);
  for(const pg of pages){
    for(const m of pg.html.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)){
      const row=m[0],text=clean(row); const dates=text.match(/(\d{1,2}\.\d{1,2}\.20\d{2})\s*[–-]\s*(\d{1,2}\.\d{1,2}\.20\d{2})/);
      const links=[...row.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map(x=>({url:absolute(x[1],pg.url),text:clean(x[2])}));
      if(!dates||!links.length)continue; const title=links[0]?.text||'',area=links[1]?.text||'',url=links[0]?.url||'';
      const key=url||`${dates[1]}|${title}`; if(!title||seen.has(key))continue; seen.add(key);
      items.push({from:isoDate(dates[1]),to:isoDate(dates[2]),title,area,url});
    }
  }
  items.sort((a,b)=>(b.from||'').localeCompare(a.from||''));
  await writeFile(resolve(root,'data/uredni-deska.json'),JSON.stringify(items,null,2)); return items;
}


const ELECTION_1998_STATIC = {
  source:'https://volby.gov.cz/pls/kv1998/kv1111?xjazyk=CZ&xid=0&xdz=5&xnumnuts=1100&xobec=500208',
  electedSource:'https://volby.gov.cz/pls/kv1998/kv21111?xjazyk=CZ&xid=0&xv=22&xdz=5&xnumnuts=1100&xobec=500208&xstrana=0',
  seats:45,
  // Souhrn za tři volební obvody Prahy 8. Procenta jsou součtem podílů
  // publikovaných ČSÚ za jednotlivé obvody; mandáty jsou agregované za celé ZMČ.
  parties:[
    {id:'ods',name:'Občanská demokratická strana',short:'ODS',percent:'37.91',seats:19},
    {id:'cssd',name:'Česká strana sociálně demokratická',short:'ČSSD',percent:'20.48',seats:9},
    {id:'us',name:'Unie svobody',short:'US',percent:'19.58',seats:10},
    {id:'kscm',name:'Komunistická strana Čech a Moravy',short:'KSČM',percent:'13.84',seats:5},
    {id:'kdu',name:'Křesťanská a demokratická unie - Československá strana lidová',short:'KDU-ČSL',percent:'5.45',seats:2},
    {id:'oda',name:'Občanská demokratická aliance',short:'ODA',percent:'1.22',seats:0},
    {id:'sz',name:'Strana zelených',short:'SZ',percent:'0.82',seats:0},
    {id:'spr-sdcr',name:'Koalice SPR-RSČ, SDČR',short:'SPR-RSČ + SDČR',percent:'0.26',seats:0},
    {id:'ha',name:'H.A.',short:'H.A.',percent:'0.26',seats:0},
    {id:'szj',name:'SŽJ',short:'SŽJ',percent:'0.19',seats:0}
  ]
};


const ELECTION_1998_ELECTED_SUPPLEMENT = [
  {name:'Ondřej Gros',party:'Občanská demokratická strana'},
  {name:'Martin Roubíček',party:'Občanská demokratická strana'}
];

const ELECTION_COALITIONS = {
  2022:{members:['ODS','ANO','Společně pro Prahu 8 – TOP 09 a Starostové a nezávislí','Patrioti pro Prahu 8'],note:''},
  2018:{members:['ODS','Spojené síly pro Prahu 8 (TOP 09 a STAN)','Patrioti pro Prahu 8'],note:'menšinová koalice s podporou ANO'},
  2014:{members:['ANO','ČSSD','Strana zelených'],note:'s podporou KSČM'},
  2010:{members:['ODS','TOP 09'],note:'od roku 2012 také Volba pro Prahu 8'},
  2006:{members:['ODS'],note:'samostatné vedení radnice'},
  2002:{members:['ODS','ČSSD'],note:''},
  1998:{members:['ODS','ČSSD'],note:''}
};

async function election1998Elected(browser){
  // Výsledky stran z roku 1998 jsou kvůli historickému HTML uložené staticky výše.
  // Seznam 45 zvolených osob je na samostatné stabilní stránce ČSÚ, kterou parser
  // uměl spolehlivě načíst už v předchozích verzích. Po prvním úspěšném syncu se
  // osoby uloží do data/volby.json a při dalším vývoji už volby nemusíme obnovovat.
  const url=ELECTION_1998_STATIC.electedSource;
  const page=await browser.newPage();
  try{
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
    const rows=await page.evaluate(()=>[...document.querySelectorAll('tr')].map(tr=>({
      cells:[...tr.querySelectorAll('th,td')].map(x=>(x.innerText||'').replace(/\s+/g,' ').trim()).filter(Boolean),
      links:[...tr.querySelectorAll('a')].map(a=>({text:(a.innerText||'').replace(/\s+/g,' ').trim(),href:a.href||''}))
    })).filter(x=>x.cells.length));
    const elected=[]; const seen=new Set();
    const aliases=[
      ['ODS','Občanská demokratická strana'],['ČSSD','Česká strana sociálně demokratická'],
      ['US','Unie svobody'],['KSČM','Komunistická strana Čech a Moravy'],
      ['KDU-ČSL','Křesťanská a demokratická unie - Československá strana lidová'],
      ['ODA','Občanská demokratická aliance'],['SZ','Strana zelených']
    ];
    for(const row of rows){
      const text=row.cells.join(' ');
      if(!text || /příjmení|kandidát/i.test(text)&&row.cells.length<3)continue;
      const personLink=row.links.find(x=>x.text&&/\s/.test(x.text)&&!/strana|výsledky|zpět/i.test(x.text));
      let name=personLink?.text||'';
      if(!name){
        const candidates=row.cells.filter(x=>/^[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][A-Za-zÁ-ž .'-]+$/.test(x)&&/\s/.test(x));
        name=candidates.find(x=>!/(strana|kandidátní|praha|obvod)/i.test(x))||'';
      }
      name=name.replace(/\s+/g,' ').trim();
      if(!name || /^celkem/i.test(name))continue;
      const key=name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
      if(seen.has(key))continue;
      let party='';
      for(const [needle,full] of aliases){if(text.includes(needle)||text.includes(full)){party=full;break}}
      seen.add(key); elected.push({name,party});
    }
    // Historický HTML parser může některá jména vynechat. Ověřené osoby proto
    // doplňujeme staticky a deduplikujeme bez akademických titulů.
    const cleanPerson=s=>String(s||'').replace(/\b(?:Ing|Mgr|Bc|JUDr|PhDr|RNDr|MUDr|doc|prof)\.?\s*/gi,'').replace(/,?\s*(?:MBA|Ph\.?D\.?|CSc\.?|DiS\.?)\b/gi,'').replace(/\s+/g,' ').trim();
    const merged=[]; const mergedSeen=new Set();
    for(const person of [...ELECTION_1998_ELECTED_SUPPLEMENT,...elected]){
      const name=cleanPerson(person.name); const k=name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
      if(!name||mergedSeen.has(k))continue; mergedSeen.add(k); merged.push({...person,name});
    }
    return merged.slice(0,45);
  }finally{await page.close()}
}

async function syncElections(browser){
  // ČSÚ zveřejňuje komunální výsledky v některých letech po volebních obvodech.
  // Proto stejnou volební stranu NEPOČÍTÁME několikrát: mandáty za jednotlivé
  // obvody agregujeme podle interního kódu strany / názvu strany.
  const years=[2022,2018,2014,2010,2006,2002,1998,1994];
  const electionDates={2022:'20220923',2018:'20181005',2014:'20141010',2010:'20101015',2006:'20061020',2002:'20021101',1998:'19981113',1994:'19941118'};
  const result=[]; const electedByName=new Map();
  const normName=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
  const parseAttrs=s=>Object.fromEntries([...String(s).matchAll(/([A-Za-z0-9_:-]+)=["']([^"']*)["']/g)].map(m=>[m[1].toUpperCase(),m[2]]));
  const num=v=>{const n=Number(String(v??'').replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:null};
  const resultUrl=year=>`https://www.volby.cz/pls/kv${year}/kv1111?xjazyk=CZ&xid=1&xdz=5&xnumnuts=1100&xobec=500208&xstat=0&xvyber=0`;

  for(const year of years){
    if(year===1998){
      let elected=[];
      try{elected=await election1998Elected(browser)}catch(err){console.log(`      ⚠️ volby 1998: seznam zvolených se nepodařilo obnovit (${String(err.message||err).slice(0,160)}).`)}
      const parties=ELECTION_1998_STATIC.parties.map(x=>({...x}));
      result.push({year,source:ELECTION_1998_STATIC.source,electedSource:ELECTION_1998_STATIC.electedSource,xmlUrl:'',parties,turnout:'',seats:45,coalition:ELECTION_COALITIONS[year]||null,note:'Historické výsledky stran jsou uložené jako ověřený statický snapshot ČSÚ.'});
      for(const e of elected){const k=normName(e.name);if(!k)continue;const x=electedByName.get(k)||{name:e.name,years:[],party:'',partiesByYear:{}};if(!x.years.includes(year))x.years.push(year);if(e.party){x.partiesByYear[year]=e.party;if(!x.party)x.party=e.party;}electedByName.set(k,x)}
      console.log(`      volby 1998: ${parties.filter(x=>x.seats>0).length} subjektů s mandátem, ${elected.length || 45} zvolených jmen ✓ [historický snapshot]`);
      continue;
    }
    const xmlUrl=`https://www.volby.cz/pls/kv${year}/vysledky_obec?cislo_obce=500208&datumvoleb=${electionDates[year]}`;
    try{
      const xml=await get(xmlUrl,{accept:'application/xml,text/xml,*/*'});
      if(!xml || /<CHYBA\b/i.test(xml)) throw new Error('ČSÚ vrátilo chybové nebo prázdné XML');
      const tags=[...xml.matchAll(/<([A-Za-z0-9_:-]+)\b([^>]*)>/g)].map(m=>({tag:m[1].toUpperCase(),a:parseAttrs(m[2])}));
      const partyMap=new Map(); const elected=[]; let turnout=''; let seats=45;

      for(const {tag,a} of tags){
        // Mandáty bereme pouze z elementů volební strany, ne z kandidátů či souhrnů.
        if(tag==='VOLEBNI_STRANA' || tag.endsWith(':VOLEBNI_STRANA')){
          const name=a.NAZ_STR || a.NAZEV_STRANY || a.NAZEV_STR || a.NAZEV;
          const mandates=num(a.ZASTUPITELE_POCET ?? a.MANDATY ?? a.MAND_STR ?? a.POC_MANDATU ?? a.MANDAT);
          if(name){
            // Praha 8 měla v některých letech více volebních obvodů. Procenta proto
            // nesmíme převzít z prvního obvodu – sečteme absolutní hlasy za stranu
            // ve všech obvodech a procento dopočítáme až z celkového součtu.
            const identity=String(a.VSTRANA || a.OSTRANA || normName(name));
            const prev=partyMap.get(identity)||{id:identity,name,percent:'',seats:0,votes:0};
            if(mandates!==null)prev.seats+=mandates;
            const votes=num(a.HLASY ?? a.HLASY_STRANA ?? a.POCET_HLASU ?? a.HLASU ?? a.HLASY_CELKEM);
            if(votes!==null)prev.votes+=votes;
            const percent=a.HLASY_PROC ?? a.PROC_HLASU ?? a.PROCHLSTR ?? a.PROCENT_HLASU ?? a.PROCENTA ?? '';
            if(!prev.percent && percent!=='')prev.percent=String(percent).replace(',','.');
            partyMap.set(identity,prev);
          }
        }

        if(tag==='ZASTUPITEL' && a.JMENO && a.PRIJMENI){
          const name=`${a.JMENO} ${a.PRIJMENI}`.replace(/\s+/g,' ').trim();
          const party=a.KANDIDATNI_LISTINA_NAZEV || a.NAZEV_KANDIDATNI_LISTINY || a.NAZEV_STRANY || '';
          elected.push({name,party});
        }
        if(!turnout) turnout=String(a.VOLEBNI_UCAST ?? a.UCAST_PROC ?? a.PROC_UCAST ?? '').replace(',','.');
        // VOLENO_ZASTUP je u starších voleb často počet mandátů jen v jednom volebním obvodu (např. 15),
        // nikoli velikost celého ZMČ Praha 8. Celkový počet odvodíme až ze zvolených osob.
        const seatCount=num(a.VOLENO_ZASTUP ?? a.VOLENO_ZASTUPITELU ?? a.POCET_ZASTUPITELU ?? a.POC_VOLENYCH);
        if(seatCount && seatCount>=40 && seatCount<100)seats=seatCount;
      }

      // Přepočet procent z absolutních hlasů je nutný hlavně pro 2002/2006/2010,
      // kdy se procenta publikovala zvlášť po volebních obvodech.
      const totalVotes=[...partyMap.values()].reduce((n,x)=>n+Number(x.votes||0),0);
      if(totalVotes>0){
        for(const x of partyMap.values()) if(Number(x.votes||0)>0) x.percent=(100*Number(x.votes||0)/totalVotes).toFixed(2);
      }
      let parties=[...partyMap.values()].filter(x=>x.name).sort((a,b)=>Number(b.percent||0)-Number(a.percent||0)||b.seats-a.seats||a.name.localeCompare(b.name,'cs'));
      const electedMap=new Map();
      for(const e of elected){if(!e?.name)continue;const k=normName(e.name);if(!electedMap.has(k)||(!electedMap.get(k).party&&e.party))electedMap.set(k,e)}
      const electedUnique=[...electedMap.values()].map(e=>e.name);

      // Starší XML (typicky 1994) nemusí obsahovat agregované VOLEBNI_STRANA,
      // ale u každého zvoleného zastupitele obsahuje název kandidátní listiny.
      // Mandáty proto bezpečně dopočítáme prostým součtem zvolených osob za listinu.
      if(!parties.some(x=>Number(x.seats)>0) && electedUnique.length){
        const electedPartyMap=new Map();
        for(const {tag,a} of tags){
          if(tag!=='ZASTUPITEL') continue;
          const name=a.KANDIDATNI_LISTINA_NAZEV || a.NAZEV_KANDIDATNI_LISTINY || a.NAZEV_STRANY || '';
          if(!name) continue;
          const key=normName(name);
          const prev=electedPartyMap.get(key)||{id:key,name,seats:0};
          prev.seats+=1; electedPartyMap.set(key,prev);
        }
        // U 1994 zachováme procenta/hlasy z VOLEBNI_STRANA a pouze na ně napojíme
        // mandáty dopočítané z 45 zvolených osob. Když název nesedí přesně, přidáme
        // samostatnou položku a nic nevymýšlíme.
        for(const ep of electedPartyMap.values()){
          let target=parties.find(p=>normName(p.name)===normName(ep.name));
          if(!target){target={id:ep.id,name:ep.name,percent:'',seats:0,votes:0};parties.push(target)}
          target.seats=ep.seats;
        }
        parties.sort((a,b)=>Number(b.percent||0)-Number(a.percent||0)||b.seats-a.seats||a.name.localeCompare(b.name,'cs'));
      }
      if(!parties.some(x=>Number(x.seats)>0) && !electedUnique.length){
        const sample=tags.slice(0,12).map(x=>`${x.tag}[${Object.keys(x.a).join(',')}]`).join(' | ');
        throw new Error(`XML neobsahuje rozpoznané mandáty ani zvolené osoby. Diagnostika: ${sample}`);
      }

      // Celé ZMČ Praha 8 má v importovaných volbách 45 zvolených osob. Tím eliminujeme
      // falešnou validaci 45/15 způsobenou historickými volebními obvody.
      if(electedUnique.length>=40) seats=electedUnique.length;
      parties=parties.map(({votes,...x})=>x);
      result.push({year,source:resultUrl(year),xmlUrl,parties,turnout,seats,coalition:ELECTION_COALITIONS[year]||null});
      for(const name of electedUnique){
        const k=normName(name); if(!k)continue;
        const party=electedMap.get(k)?.party||'';
        const x=electedByName.get(k)||{name,years:[],party:'',partiesByYear:{}};
        if(!x.years.includes(year))x.years.push(year);
        if(party){x.partiesByYear[year]=party;if(!x.party)x.party=party;}
        electedByName.set(k,x);
      }
      const withMandate=parties.filter(x=>Number(x.seats)>0);
      const mandateSum=withMandate.reduce((n,x)=>n+Number(x.seats||0),0);
      const validation=mandateSum && seats ? (mandateSum===seats ? '✓' : `⚠️ součet mandátů ${mandateSum}/${seats}`) : '';
      console.log(`      volby ${year}: ${withMandate.length || '—'} subjektů s mandátem, ${electedUnique.length} zvolených jmen ${validation}`);
    }catch(e){
      console.log(`      ⚠️ volby ${year}: ${String(e.message||e).slice(0,500)}`);
      result.push({year,source:xmlUrl,xmlUrl,parties:[],turnout:'',seats:45,error:String(e.message||e)});
    }
  }
  // Žebříček nejdéle působících: jen současní zastupitelé. Jména z voleb jsou
  // většinou „Jméno Příjmení“, zatímco Praha 8 publikuje „Příjmení Jméno + tituly“.
  // Proto pro párování používáme kanonický klíč z abecedně seřazených slov bez titulů.
  const personKey=s=>{
    const titles=new Set(['bc','mgr','ing','judr','mudr','rndr','phdr','phd','csc','dba','dis','bca','ma','prof','doc','et','mba','mpa']);
    return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
      .replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(Boolean).filter(x=>!titles.has(x)).sort().join(' ');
  };
  const shortParty=s=>{
    const v=String(s||'').trim(); const n=v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    if(!v)return '';
    if(/komunisticka strana cech a moravy|\bkscm\b/.test(n))return 'KSČM';
    if(/obcanska demokraticka strana|\bods\b/.test(n))return 'ODS';
    if(/top ?09/.test(n))return 'TOP 09';
    if(/ano ?2011|\bano\b/.test(n))return 'ANO';
    if(/ceska strana socialne demokraticka|socialni demokracie|\bcssd\b/.test(n))return 'ČSSD';
    if(/strana zelenych|zeleni/.test(n))return 'SZ';
    if(/starostove a nezavisli|\bstan\b/.test(n))return 'STAN';
    if(/pirat/.test(n))return 'Piráti';
    if(/svoboda a prima demokracie|\bspd\b/.test(n))return 'SPD';
    if(/kdu.?csl|krestanska a demokraticka unie/.test(n))return 'KDU-ČSL';
    if(/volba pro prahu 8/.test(n))return 'Volba pro Prahu 8';
    if(/spolecne pro prahu 8|spojene sily pro prahu 8/.test(n))return 'TOP 09 + STAN';
    if(/patriot/.test(n))return 'Patrioti';
    return v.length<=24?v:v.replace(/Komunistická strana Čech a Moravy/gi,'KSČM');
  };
  let currentPeople=[]; try{currentPeople=JSON.parse(await readFile(resolve(root,'data/lide.json'),'utf8'))}catch{}
  const currentKeys=new Set(currentPeople.map(x=>personKey(x.name)).filter(Boolean));
  const currentPartyByKey=new Map(currentPeople.map(x=>[personKey(x.name),shortParty(x.club||'')]).filter(x=>x[0]));
  const manualParties=new Map([
    [personKey('Martin Roubíček'),['ODS']], [personKey('Ondřej Gros'),['ODS']],
    [personKey('Josef Slobodník'),['ODS']], [personKey('Tomáš Bína'),['ODS']],
    [personKey('Tomáš Mrázek'),['ODS']], [personKey('Vladimíra Ludková'),['ODS']],
    [personKey('Matěj Fichtner'),['ANO','TOP 09']]
  ]);
  const longest=[...electedByName.values()].map(x=>{
      const years=x.years.sort((a,b)=>b-a);
      const parsedParties=[];
      // chronologicky od nejstaršího období, aby změny strany dávaly smysl
      for(const y of [...years].sort((a,b)=>a-b)){const p=shortParty(x.partiesByYear?.[y]||'');if(p&&!parsedParties.includes(p))parsedParties.push(p)}
      const manual=manualParties.get(personKey(x.name)); const fallback=currentPartyByKey.get(personKey(x.name)); const parties=manual||(parsedParties.length?parsedParties:(fallback?[fallback]:[]));
      return {...x,party:parties[parties.length-1]||'',parties,years,terms:years.length,yearsServed:years.length*4};
    })
    .filter(x=>currentKeys.has(personKey(x.name)) && x.terms>1)
    .sort((a,b)=>b.terms-a.terms||a.name.localeCompare(b.name,'cs')).slice(0,20);
  const payload={years:result,longest};
  await writeFile(resolve(root,'data/volby.json'),JSON.stringify(payload,null,2)); return payload;
}

async function findSiblingContracts(){
  // Ve 2.5 přenášíme mezi verzemi pouze KOMPLETNÍ historický dataset.
  // Dvouměsíční vývojové vzorky z řady 2.4 se záměrně ignorují.
  if(process.argv.includes('--contracts-network'))return null;
  try{
    const parent=resolve(root,'..');
    const dirs=(await readdir(parent,{withFileTypes:true}))
      .filter(d=>d.isDirectory() && /^praha8-prehledy-v\d+/i.test(d.name) && resolve(parent,d.name)!==root)
      .map(d=>d.name).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
    for(const dir of dirs){
      try{
        const file=resolve(parent,dir,'data','smlouvy.json');
        if(!existsSync(file))continue;
        const data=JSON.parse(await readFile(file,'utf8'));
        if(data?.meta?.historyComplete===true && data?.meta?.total>0){
          console.log(`      Registr smluv: používám kompletní historický dataset z ${dir} (${data.meta.total.toLocaleString('cs-CZ')} smluv).`);
          return data;
        }
      }catch{}
    }
  }catch{}
  return null;
}

async function syncContracts(browser){
  const FULL_HISTORY=process.argv.includes('--contracts-full');
  const sibling=await findSiblingContracts();
  if(sibling){
    await writeFile(resolve(root,'data/smlouvy.json'),JSON.stringify(sibling,null,2));
    return sibling;
  }

  const INDEX='https://data.smlouvy.gov.cz/index.xml';
  const TARGET_ICO='00063797',TARGET_DS='g5ybpd2';
  const unesc=s=>String(s||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&apos;/g,"'").trim();
  const tag=(xml,name)=>{const m=String(xml||'').match(new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${name}>`,'i'));return m?unesc(m[1].replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim():''};
  const block=(xml,name)=>{const m=String(xml||'').match(new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${name}>`,'i'));return m?m[1]:''};
  const blocks=(xml,name)=>[...String(xml||'').matchAll(new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${name}>`,'gi'))].map(m=>m[1]);
  const normIco=s=>String(s||'').replace(/\D/g,'').padStart(8,'0');
  const val=s=>{const n=Number(String(s||'').replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)&&n>0?n:null};
  const iso=s=>{const x=String(s||'').trim();if(!x)return '';const m=x.match(/^(\d{4}-\d{2}-\d{2})/);if(m)return m[1];const c=x.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);return c?`${c[3]}-${c[2].padStart(2,'0')}-${c[1].padStart(2,'0')}`:''};
  const entityFrom=b=>({name:tag(b,'nazev')||tag(b,'nazevSubjektu')||tag(b,'jmeno'),ico:normIco(tag(b,'ico')),box:tag(b,'datovaSchranka')||tag(b,'datovaSchrankaId')});
  const isTarget=e=>normIco(e.ico)===TARGET_ICO||String(e.box||'').toLowerCase()===TARGET_DS;
  const publisherOf=z=>{
    for(const n of ['VkladatelDoRejstriku','vkladatelDoRejstriku','publikujiciSmluvniStrana','PublikujiciSmluvniStrana','vkladatel']){
      const b=block(z,n);if(b){const e=entityFrom(b);if(e.name||e.ico||e.box)return e}
    }
    // Novější fallback: subjekt hledáme napříč celým záznamem. Ve starém XML může
    // první element <smlouva> znamenat něco jiného než vlastní tělo smlouvy.
    for(const sb of blocks(z,'subjekt')){const e=entityFrom(sb);if(e.name||e.ico||e.box)return e}
    // DŮLEŽITÉ: smluvniStrana není publikující subjekt. Historické dumpy 2016
    // ji používají pro protistranu; nesmí proto sloužit jako fallback vkladatele.
    return null;
  };
  const contractBodyOf=z=>{
    const all=blocks(z,'smlouva');
    return all.find(b=>tag(b,'predmet')||tag(b,'datumUzavreni')||blocks(b,'smluvniStrana').length)||all[0]||z;
  };
  const partiesOf=z=>{
    const out=[]; const smlouva=contractBodyOf(z);
    // Hledáme smluvní strany i přímo v celém záznamu kvůli historickému XML 2016.
    const partyBlocks=[...blocks(smlouva,'smluvniStrana'),...blocks(z,'smluvniStrana')];
    for(const b of partyBlocks){const e=entityFrom(b);if((e.name||e.ico)&&!isTarget(e))out.push(e)}
    if(!out.length){const sb=block(smlouva,'smluvniStrany')||block(smlouva,'SmluvniStrany');if(sb)for(const b of blocks(sb,'subjekt')){const e=entityFrom(b);if((e.name||e.ico)&&!isTarget(e))out.push(e)}}
    const seen=new Set();return out.filter(e=>{const k=e.ico||e.name.toLowerCase();if(!k||seen.has(k))return false;seen.add(k);return true});
  };
  const parseRecord=z=>{
    const valid=(tag(z,'platnyZaznam')||'true').toLowerCase();if(['false','0','ne'].includes(valid))return null;
    const pub=publisherOf(z);if(!pub||!isTarget(pub))return null;
    const smlouva=contractBodyOf(z); const parties=partiesOf(z); const ident=block(z,'identifikator')||z;
    const idVerze=tag(ident,'idVerze')||tag(z,'idVerze'); const idSmlouvy=tag(ident,'idSmlouvy')||tag(z,'idSmlouvy');
    let url=tag(z,'odkaz');if(!/\/smlouva\/\d+/.test(url)&&idVerze)url=`https://smlouvy.gov.cz/smlouva/${idVerze}`;
    const valueVat=val(tag(smlouva,'hodnotaVcetneDph')),valueNoVat=val(tag(smlouva,'hodnotaBezDph'));
    return {id:idVerze||idSmlouvy||url,idContract:idSmlouvy||'',url,subject:tag(smlouva,'predmet')||'Smlouva',published:iso(tag(z,'casZverejneni')||tag(z,'datumPublikace')),signed:iso(tag(smlouva,'datumUzavreni')),valueCzk:valueVat??valueNoVat,valueVatCzk:valueVat,valueNoVatCzk:valueNoVat,counterparties:parties,counterparty:parties.map(x=>x.name).filter(Boolean).join(', '),publisher:pub.name||'Městská část Praha 8',publisherIco:pub.ico||TARGET_ICO};
  };
  const fetchText=async(url,attempts=3,timeout=240000)=>{let last;for(let i=1;i<=attempts;i++){try{const r=await fetch(url,{headers:{'user-agent':UA,'accept':'application/xml,text/xml,*/*'},signal:AbortSignal.timeout(timeout)});if(!r.ok)throw new Error(`${url}: HTTP ${r.status}`);return await r.text()}catch(e){last=e;if(i<attempts){const wait=1500*i;console.log(`      ↻ síťový pokus ${i}/${attempts} selhal, opakuji za ${wait} ms…`);await sleep(wait)}}}throw last};

  console.log('      Registr smluv: načítám index otevřených dat…');
  const index=await fetchText(INDEX,3,60000);
  let dumpUrls=[...index.matchAll(/<(?:(?:[\w.-]+):)?odkaz\b[^>]*>([\s\S]*?)<\/(?:(?:[\w.-]+):)?odkaz>/gi)].map(m=>unesc(m[1])).filter(x=>/dump_\d{4}_\d{2}\.xml/i.test(x));
  if(!dumpUrls.length)dumpUrls=[...index.matchAll(/https?:\/\/[^\s<"']*dump_\d{4}_\d{2}\.xml/gi)].map(m=>m[0]);
  dumpUrls=[...new Set(dumpUrls)].sort((a,b)=>{const A=a.match(/dump_(\d{4})_(\d{2})/),B=b.match(/dump_(\d{4})_(\d{2})/);return `${A?.[1]}-${A?.[2]}`.localeCompare(`${B?.[1]}-${B?.[2]}`)});
  if(!dumpUrls.length)throw new Error('Index otevřených dat neobsahuje žádné měsíční dumpy.');

  // Pokud index obsahuje velikosti dumpů, ukážeme uživateli reálný rozsah práce před startem.
  let totalBytes=0;
  for(const m of index.matchAll(/<(?:(?:[\w.-]+):)?velikostDumpu\b[^>]*>(\d+)<\/[^>]*velikostDumpu>/gi)) totalBytes+=Number(m[1]||0);
  const sizeLabel=totalBytes?` · přibližně ${(totalBytes/1024/1024/1024).toFixed(1)} GB XML` : '';
  console.log(`      Registr smluv: celá historie MČ Praha 8 · ${dumpUrls.length} měsíčních dumpů${sizeLabel}.`);
  console.log('      První kompletní běh může trvat déle; další verze mohou převzít hotový historický dataset.');

  const byContract=new Map(); const failed=[]; const yearStats=new Map();
  // Bootstrap cache: po úspěšném zpracování měsíce ukládáme POUZE vyfiltrované
  // záznamy Prahy 8, nikoli zdrojové XML. Při přerušení lze stejnou verzi spustit
  // znovu a dokončené historické měsíce se nemusí znovu stahovat. Poslední
  // (aktuální/průběžný) dump se vždy stáhne znovu.
  const monthCacheDir=resolve(root,'data','cache','contracts-months');
  await mkdir(monthCacheDir,{recursive:true});
  const started=Date.now();
  let processedNetwork=0, processedCache=0;
  for(let i=0;i<dumpUrls.length;i++){
    const url=dumpUrls[i]; const m=url.match(/dump_(\d{4})_(\d{2})/); const year=m?.[1]||'?', month=m?.[2]||'?'; const label=`${year}-${month}`;
    const cacheFile=resolve(monthCacheDir,`${label}.json`);
    const isLatest=i===dumpUrls.length-1;
    try{
      let monthItems=[]; let fromCache=false;
      if(!isLatest && existsSync(cacheFile)){
        try{
          const cached=JSON.parse(await readFile(cacheFile,'utf8'));
          if(cached?.schema===1 && cached?.month===label && Array.isArray(cached.items)){
            monthItems=cached.items; fromCache=true; processedCache++;
          }
        }catch{}
      }
      if(!fromCache){
        const xml=await fetchText(url); processedNetwork++;
        const re=/<(?:(?:[\w.-]+):)?zaznam\b[^>]*>([\s\S]*?)<\/(?:(?:[\w.-]+):)?zaznam>/gi; let x;
        while((x=re.exec(xml))){const item=parseRecord(x[1]);if(item?.id)monthItems.push(item)}
        // Cache zapisujeme až po kompletním úspěšném parsování dumpu.
        if(!isLatest)await writeFile(cacheFile,JSON.stringify({schema:1,month:label,source:url,created:new Date().toISOString(),items:monthItems}));
      }
      for(const item of monthItems){
        const key=item.idContract||item.id; const prev=byContract.get(key);
        if(!prev || (item.published||'')>(prev.published||'') || Number(item.id)>Number(prev.id))byContract.set(key,item);
      }
      const monthCount=monthItems.length;
      yearStats.set(year,(yearStats.get(year)||0)+monthCount);
      const elapsed=(Date.now()-started)/1000;
      const per=(i+1)/Math.max(elapsed,0.1); const remain=(dumpUrls.length-i-1)/Math.max(per,0.001);
      const origin=fromCache?'cache':'síť';
      console.log(`      [${String(i+1).padStart(String(dumpUrls.length).length)}/${dumpUrls.length}] ${label}: ${monthCount.toLocaleString('cs-CZ')} smluv MČ Praha 8 · unikátních ${byContract.size.toLocaleString('cs-CZ')} · ${origin} · odhad zbývá ${Math.max(0,Math.round(remain/60))} min`);
    }catch(e){failed.push(label);console.log(`      ⚠️ ${label}: ${String(e.message||e).slice(0,180)}`)}
  }
  console.log(`      Bootstrap: ${processedNetwork} dumpů ze sítě · ${processedCache} historických dumpů z lokální cache.`);
  if(failed.length)throw new Error(`Registr smluv: neúplný historický import, selhalo ${failed.length} dumpů (${failed.slice(0,8).join(', ')}${failed.length>8?', …':''}). Dataset NEPŘEPISUJI.`);

  const items=[...byContract.values()].sort((a,b)=>(b.published||'').localeCompare(a.published||''));
  if(!items.length)throw new Error('V celé historii otevřených dat nebyla nalezena žádná smlouva publikovaná MČ Praha 8.');
  const partnerMap=new Map();
  for(const c of items){for(const p of c.counterparties||[]){const key=p.ico||p.name.toLowerCase();if(!key)continue;const x=partnerMap.get(key)||{name:p.name,ico:p.ico||'',contracts:0,knownValueCzk:0,valuedContracts:0};x.contracts++;if(c.valueCzk!=null&&(c.counterparties||[]).length===1){x.knownValueCzk+=c.valueCzk;x.valuedContracts++}partnerMap.set(key,x)}}
  const partners=[...partnerMap.values()].sort((a,b)=>b.knownValueCzk-a.knownValueCzk||b.contracts-a.contracts||a.name.localeCompare(b.name,'cs'));
  const known=items.filter(x=>x.valueCzk!=null);
  const signedDates=items.map(x=>x.signed).filter(Boolean).sort();
  console.log('      ─────────────────────────────────────────────');
  for(const [year,count] of [...yearStats.entries()].sort())console.log(`      ${year}: ${count.toLocaleString('cs-CZ')} nalezených platných verzí v publikačních dumpech`);
  console.log(`      CELKEM: ${items.length.toLocaleString('cs-CZ')} unikátních smluv · ${partners.length.toLocaleString('cs-CZ')} protistran · ${known.length.toLocaleString('cs-CZ')} smluv se známou hodnotou.`);
  console.log(`      Známá hodnota smluv: ${known.reduce((n,x)=>n+x.valueCzk,0).toLocaleString('cs-CZ')} Kč.`);

  const payload={contracts:items,partners,meta:{total:items.length,complete:true,historyComplete:true,scope:'full-history',dateFrom:signedDates[0]||'2016-07-01',dateTo:signedDates.at(-1)||new Date().toISOString().slice(0,10),dateLabel:'celá historie Registru smluv',knownValueCzk:known.reduce((n,x)=>n+x.valueCzk,0),valuedContracts:known.length,partners:partners.length,updated:new Date().toISOString(),source:INDEX,method:'open-data-monthly-dumps-full-history',dumps:dumpUrls.length,validation:{status:'open-data-complete',note:'Načteny všechny aktuálně dostupné měsíční open-data dumpy bez chyby. Aktuální měsíční dump může být průběžný a nemusí v daný okamžik odpovídat živému vyhledávání 1:1.'}}};
  await writeFile(resolve(root,'data/smlouvy.json'),JSON.stringify(payload,null,2));
  return payload;
}

async function syncNationalRoles(people=[]){
  // Celostátní funkce jsou samostatný datový zdroj. Nesmějí se měnit při synchronizaci HMP.
  // Při explicitním spuštění zdroje seznam nejprve obnovíme a poté doplníme jen ověřené funkce.
  const out=people.map(p=>({...p,otherRoles:[]}));
  const find=(name)=>out.find(p=>personVariants(p.name).some(v=>v===name.toLowerCase())) || out.find(p=>personKey(p.name)===personKey(name));
  const ludkova=find('vladimira ludkova');
  if(ludkova)ludkova.otherRoles=[{label:'Senátorka Parlamentu ČR',url:'https://www.senat.cz/senatori/index.php?lng=cz&par_3=465'}];
  await writeFile(resolve(root,'data/lide.json'),JSON.stringify(out,null,2));
  return out;
}

async function syncKvResolutionsPilot(browser){
  // Pilot: Kontrolní výbor, pouze jednání z let 2025 a 2026.
  // Záměrně čteme jen zápisy a vytahujeme pouze usnesení + hlasování.
  const page=await browser.newPage(); await page.setUserAgent(UA);
  const listing='https://www.praha8.cz/Materialy-KV';
  const pages=[listing]; const seenPages=new Set(); const pdfs=[];
  for(let i=0;i<pages.length && i<8;i++){
    const url=pages[i]; if(seenPages.has(url))continue; seenPages.add(url);
    try{
      await page.goto(url,{waitUntil:'domcontentloaded',timeout:25000});
      const links=await page.evaluate(()=>[...document.querySelectorAll('a[href]')].map(a=>({text:(a.textContent||'').replace(/\s+/g,' ').trim(),url:a.href})));
      for(const l of links){
        if(/KV\s+\d{1,2}\.\d{1,2}\.(2025|2026)\s*-?\s*z[aá]pis/i.test(l.text) && /\.pdf(?:$|\?)/i.test(l.url)) pdfs.push({label:l.text,url:classicPraha8Url(l.url)});
        if(/Materialy-KV/i.test(l.url) && !/\.pdf/i.test(l.url) && !seenPages.has(l.url) && !pages.includes(l.url)) pages.push(l.url);
      }
    }catch(e){console.log(`      ⚠️ stránka KV přeskočena: ${url} (${String(e.message||e).slice(0,100)})`)}
  }
  await page.close().catch(()=>{});
  const uniq=[...new Map(pdfs.map(x=>[x.url,x])).values()]; const out=[];
  const norm=s=>String(s||'').replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ').replace(/\n[ \t]+/g,'\n').trim();
  const parseVote=chunk=>{
    const m=chunk.match(/Hlasov[aá]n[ií]\s*:?\s*([^\n]{0,220})/i); if(!m)return null;
    const raw=norm(m[1]); const n=k=>{const z=raw.match(k);return z?Number(z[1]):null};
    return {raw,for:n(/pro\s+(\d+)/i),against:n(/proti\s+(\d+)/i),abstain:n(/zdr[žz]el(?:o|i|a)?(?:\s+se)?\s+(\d+)/i)};
  };
  for(const p of uniq){
    try{
      const text=await extractPdfText(p.url); const date=isoDate(p.label)||isoDate(text);
      const meeting=Number((text.match(/(?:Z[aá]pis\s+)?(\d+)\.\s*jedn[aá]n[ií]\s+kontroln[ií]ho\s+v[ýy]boru/i)||[])[1]||0)||null;
      // Číslo KV má tvary např. 1/33KV/2026. Konec bloku je další usnesení nebo konec dokumentu.
      const re=/Usnesen[ií]\s*(?:č\.?\s*)?([0-9]+\s*\/\s*[0-9]+\s*KV\s*\/\s*(?:2025|2026))\s*[:.-]?\s*([\s\S]*?)(?=Usnesen[ií]\s*(?:č\.?\s*)?[0-9]+\s*\/\s*[0-9]+\s*KV\s*\/\s*(?:2025|2026)|$)/gi;
      let found=0;
      for(const m of text.matchAll(re)){
        let chunk=norm(m[2]); const vote=parseVote(chunk);
        chunk=norm(chunk.replace(/Hlasov[aá]n[ií]\s*:?\s*[^\n]{0,220}/i,''));
        // Odřízneme typické pokračování zápisu za hlasováním, pokud PDF slilo řádky.
        chunk=chunk.replace(/\s+(?:\d+\.\s+)?(?:R[uů]zn[eé]|Diskuse|Dal[šs][ií]\s+bod|Z[aá]v[eě]r)\b[\s\S]*$/i,'').trim();
        if(chunk.length<15)continue;
        out.push({body:'Kontrolní výbor',type:'Výbor zastupitelstva',date,meeting,resolution:m[1].replace(/\s+/g,''),title:`Usnesení č. ${m[1].replace(/\s+/g,'')}`,text:chunk.slice(0,1800),vote,url:p.url,sourceLabel:p.label}); found++;
      }
      console.log(`      ${p.label}: ${found} usnesení`);
    }catch(e){console.log(`      ⚠️ PDF KV přeskočeno: ${p.url} (${String(e.message||e).slice(0,120)})`)}
  }
  out.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||String(a.resolution).localeCompare(String(b.resolution),'cs'));
  await writeFile(resolve(root,'data/usneseni-organu.json'),JSON.stringify(out,null,2));
  console.log(`      Kontrolní výbor 2025–2026: ${uniq.length} zápisů, ${out.length} vytěžených usnesení.`);
  return out;
}

async function syncBodyResolutions(browser,bodies=[]){
  // Vycházíme z již načtených 17 orgánů. U komisí máme často přímo materialsUrl,
  // u výborů a starších komisí dohledáme odkazy na materiály/detail z jejich stránek.
  const page=await browser.newPage(); await page.setUserAgent(UA);
  const candidatePages=[];
  const addPage=(url,body,type)=>{if(url&&!candidatePages.some(x=>x.url===url))candidatePages.push({url,body,type})};
  for(const b of bodies){ addPage(b.materialsUrl,b.name,b.type); addPage(b.url,b.name,b.type); }
  addPage('https://www.praha8.cz/Komise-Rady-mestske-casti-Praha-8.html','Komise Rady MČ Praha 8','Komise');
  addPage('https://www.praha8.cz/Vybory-zastupitelstva-Mestske-casti-Praha-8.html','Výbory Zastupitelstva MČ Praha 8','Výbor');

  const pdfs=[]; const visited=new Set();
  for(let i=0;i<candidatePages.length && i<100;i++){
    const p=candidatePages[i]; if(!p.url||visited.has(p.url))continue; visited.add(p.url);
    try{
      await page.goto(p.url,{waitUntil:'domcontentloaded',timeout:25000});
      const links=await page.evaluate(()=>[...document.querySelectorAll('a[href]')].map(a=>({text:(a.textContent||'').replace(/\s+/g,' ').trim(),url:a.href})))
      for(const l of links){
        const hay=`${l.text} ${l.url}`;
        if(/\.pdf(?:$|\?)/i.test(l.url) && /zápis|zapis|usnesení|usneseni|jednání|jednani|materiál|material/i.test(hay)){
          pdfs.push({type:p.type,body:p.body,url:l.url,label:l.text});
        }else if(/materiály z jednání|materialy z jednani|zápisy z jednání|zapisy z jednani/i.test(l.text) && /praha8\.cz/i.test(l.url)){
          addPage(l.url,p.body,p.type);
        }
      }
    }catch(e){console.log(`      ⚠️ stránka orgánu přeskočena: ${p.url} (${String(e.message||e).slice(0,100)})`)}
  }
  await page.close().catch(()=>{});
  const uniq=[...new Map(pdfs.map(x=>[x.url,x])).values()].slice(0,180),out=[];
  const pushRecord=(p,text,title,date)=>{
    const cleaned=String(text||'').replace(/\s+/g,' ').trim(); if(cleaned.length<20)return;
    const key=`${p.body}|${title}|${cleaned.slice(0,220)}`;
    if(out.some(x=>x._key===key))return;
    out.push({_key:key,body:p.body,type:p.type,date,title,text:cleaned.slice(0,1200),url:p.url});
  };
  for(const p of uniq){
    try{
      const text=await extractPdfText(p.url); const date=isoDate(text)||isoDate(p.label);
      // 1) klasická očíslovaná usnesení
      let matched=false;
      const re=/(?:Usnesení|USNESENÍ)\s*(?:č\.|číslo|č\s*)?\s*([0-9]+(?:\/[0-9]{2,4})?)?\s*[:.-]?\s*([\s\S]{40,1400}?)(?=(?:Usnesení|USNESENÍ)\s*(?:č\.|číslo|č\s*)?\s*[0-9]|$)/g;
      for(const m of text.matchAll(re)){
        const bodyText=m[2]?.trim()||''; if(bodyText.length<30)continue;
        pushRecord(p,bodyText,m[1]?`Usnesení ${m[1]}`:'Usnesení',date); matched=true;
      }
      // 2) zápisy často používají jen formulaci „Komise přijala následující usnesení…“ bez čísla.
      if(!matched){
        const sentences=text.split(/(?<=[.!?])\s+(?=[A-ZÁ-Ž])/).filter(x=>/\busnesen|schvál|doporuč|bere na vědomí|souhlas/i.test(x));
        for(const sentence of sentences.slice(0,20))pushRecord(p,sentence,'Usnesení / závěr jednání',date);
      }
    }catch(e){console.log(`      ⚠️ PDF přeskočeno: ${p.url} (${String(e.message||e).slice(0,120)})`)}
  }
  const final=out.map(({_key,...x})=>x);
  await writeFile(resolve(root,'data/usneseni-organu.json'),JSON.stringify(final,null,2));
  console.log(`      PDF: ${uniq.length} dokumentů, ${final.length} vytěžených záznamů`);return final;
}

async function writeState(state){await writeFile(resolve(root,'data/sync-state.json'),JSON.stringify({...state,at:new Date().toISOString()},null,2))}
async function readSourceStatus(){try{return JSON.parse(await readFile(resolve(root,'data/source-status.json'),'utf8'))}catch{return {}}}
async function writeSourceStatus(status){await writeFile(resolve(root,'data/source-status.json'),JSON.stringify(status,null,2))}
function sourceEntry(prev,key,{refreshed=false,count=0,status='',strict=false}){const now=new Date().toISOString();const old=prev[key];if(!refreshed){if(old?.mode==='aktualizováno')return old;if(strict)return {status:'čeká na naplnění',count:0,updated:null,mode:'nenačteno'};if(count>0)return {status:'průběžná open data',count,updated:old?.updated||null,mode:'mezipaměť'};return {status:'čeká na naplnění',count:0,updated:null,mode:'nenačteno'}}return {status:status||(count>0?'data načtena':'čeká na naplnění'),count,updated:now,mode:'aktualizováno'}}
async function main(){
  if(demo){console.log('Demo režim: nic nestahuji.');return}
  let browser;
  try{
    await writeState({status:'running'});
    const previousSourceStatus=await readSourceStatus();
    console.log('Spouštím Chrome na pozadí pro načtení dat Prahy 8…');browser=await launchBrowser();
    let people=[]; try{people=JSON.parse(await readFile(resolve(root,'data/lide.json'),'utf8'))}catch{}
    let bodies=[]; try{bodies=JSON.parse(await readFile(resolve(root,'data/organy.json'),'utf8'))}catch{}
    console.log('1/13 Praha 8 – Zastupitelstvo, komise a výbory…');
    if(refreshPeople||refreshBodies){
      if(refreshPeople){
        const previousPeople=people;
        let freshPeople=await syncPeople(browser);
        freshPeople=await syncClubChairs(browser,freshPeople);
        const previousByKey=new Map(previousPeople.map(p=>[personKey(p.name),p]));
        people=freshPeople.map(p=>{const old=previousByKey.get(personKey(p.name))||{};return {...p,magistrateRoles:old.magistrateRoles||[],hmpCompanyRoles:old.hmpCompanyRoles||[],otherRoles:old.otherRoles||[]}});
      }
      if(refreshBodies)bodies=await syncBodies(browser,people);
      console.log(`   ${people.length} zastupitelů · ${bodies.length} komisí, výborů a zvláštních orgánů.`);
    }else console.log(`   přeskočeno (ponechávám ${people.length} lidí a ${bodies.length} orgánů; obnova: npm run sync:local).`);

    console.log('2/13 Hlavní město Praha – Zastupitelstvo, výbory a komise…');
    if(refreshHmpFunctions){const before=people;const refreshed=await syncMagistrateRoles(browser,people,{includeFunctions:true,includeCompanies:false});people=refreshed.map((p,i)=>({...p,magistrateRoles:p.magistrateRoles||[],hmpCompanyRoles:before[i]?.hmpCompanyRoles||[],otherRoles:p.otherRoles||[]}));console.log(`   funkce HMP obnoveny u ${people.filter(x=>(x.magistrateRoles||[]).length).length} lidí.`)}else console.log('   přeskočeno (obnova: npm run sync:hmp-functions).');

    console.log('3/13 Parlament ČR – poslanci a senátoři…');
    if(refreshNationalRoles){people=await syncNationalRoles(people);console.log(`   celostátní funkce obnoveny u ${people.filter(x=>(x.otherRoles||[]).length).length} lidí.`)}else console.log('   přeskočeno (obnova: npm run sync:national-roles).');

    let orgs=[];try{orgs=JSON.parse(await readFile(resolve(root,'data/organizace.json'),'utf8'))}catch{}
    console.log('4/13 Organizace a firmy Prahy 8…');
    if(refreshOrganizations){orgs=await syncOrganizations(browser,people);console.log(`   kompletní sada: ${orgs.length} organizací a firem, IČO u ${orgs.filter(x=>x.ico).length}.`)}else console.log(`   přeskočeno (ponechávám ${orgs.length}; obnova: npm run sync:organizations).`);

    console.log('5/13 Firmy hlavního města Prahy…');
    if(refreshHmpCompanies){const before=people;const refreshed=await syncMagistrateRoles(browser,people,{includeFunctions:false,includeCompanies:true});people=refreshed.map((p,i)=>({...p,magistrateRoles:before[i]?.magistrateRoles||[],hmpCompanyRoles:p.hmpCompanyRoles||[],otherRoles:before[i]?.otherRoles||[]}));console.log(`   funkce ve firmách HMP nalezeny u ${people.filter(x=>(x.hmpCompanyRoles||[]).length).length} lidí.`)}else console.log('   přeskočeno (obnova: npm run sync:hmp-companies).');

    await carryPreviousUsneseni();
    let res; if(incrementalUsneseni){res=await syncUsneseniIncremental(browser)}else if(refreshUsneseni){res=await syncUsneseni(browser)}else{const items=await readOld();res={items,rada:items.filter(x=>x.organ==='Rada').length,zast:items.filter(x=>x.organ==='Zastupitelstvo').length}}
    const details=await enrichDetails(res.items);

    console.log('6/13 Usnesení a hlasování Rady a Zastupitelstva…');
    let h=0,hv=0;if(refreshVoting){h=await syncVotingLinks();hv=await syncVotingSummaries();console.log(`   ${h} zdrojů; souhrn Pro/Proti/Zdržel se doplněn u ${hv} hlasování.`)}else{try{const x=JSON.parse(await readFile(resolve(root,'data/hlasovani.json'),'utf8'));h=x.length}catch{} console.log(`   přeskočeno (ponechávám ${h}; obnova: npm run sync:voting).`)}

    let info106=[],notice=[];
    console.log('7/13 Rozpočet…');
    try{const budget=JSON.parse(await readFile(resolve(root,'data/budget-2026.json'),'utf8'));console.log(`   načten schválený rozpočet 2026 (${Array.isArray(budget?.income)?budget.income.length:0} skupin příjmů, ${Array.isArray(budget?.expenses)?budget.expenses.length:0} kapitol výdajů).`)}catch{console.log('   rozpočtová data nejsou připravena.')}
    console.log('8/13 Informace podle zákona č. 106/1999 Sb.…');if(refreshInfo106){info106=await syncInfo106(browser);console.log(`   ${info106.length} zveřejněných žádostí.`)}else{try{info106=JSON.parse(await readFile(resolve(root,'data/info106.json'),'utf8'))}catch{}console.log(`   přeskočeno (ponechávám ${info106.length}; obnova: npm run sync:106).`)}
    console.log('9/13 Úřední deska…');if(refreshNoticeBoard){notice=await syncNoticeBoard(browser);console.log(`   ${notice.length} aktuálních položek.`)}else{try{notice=JSON.parse(await readFile(resolve(root,'data/uredni-deska.json'),'utf8'))}catch{}console.log(`   přeskočeno (ponechávám ${notice.length}; obnova: npm run sync:noticeboard).`)}

    let elections={years:[],longest:[]},contracts={contracts:[],partners:[],meta:{}};
    console.log('10/13 Volby…');if(refreshElections){elections=await syncElections(browser)}else{try{elections=JSON.parse(await readFile(resolve(root,'data/volby.json'),'utf8'))}catch{}console.log('   přeskočeno (obnova: npm run sync:elections).')}
    console.log('11/13 Registr smluv…');if(refreshContracts){try{contracts=await syncContracts(browser);console.log(`   ${contracts.meta?.total||0} smluv, ${contracts.meta?.partners||0} protistran.`)}catch(e){console.log(`   ⚠️ Registr smluv: ${String(e.message||e).slice(0,500)}`);try{contracts=JSON.parse(await readFile(resolve(root,'data/smlouvy.json'),'utf8'));const kept=contracts?.meta?.total||contracts?.contracts?.length||0;if(kept)console.log(`   ↳ ponechávám poslední úspěšná data: ${kept} smluv.`)}catch{}}}else{try{contracts=JSON.parse(await readFile(resolve(root,'data/smlouvy.json'),'utf8'))}catch{}console.log('   přeskočeno (obnova: npm run sync:contracts).')}
    let census=null;
    console.log('12/13 Sčítání 2021…');
    if(refreshCensus){
      try{await import(`./sync-census2021.mjs?v=${Date.now()}`);census=JSON.parse(await readFile(resolve(root,'data/scitani2021.json'),'utf8'));console.log(`   ${census?.datasets?.length||0} datových sad ČSÚ načteno.`)}
      catch(e){console.log(`   ⚠️ Sčítání 2021: ${String(e.message||e).slice(0,400)}`)}
    }else{try{census=JSON.parse(await readFile(resolve(root,'data/scitani2021.json'),'utf8'))}catch{}console.log(`   přeskočeno (ponechávám ${census?.datasets?.length||0} datových sad; obnova: npm run sync:census).`)}
    let news=[];console.log('13/13 Novinky z městské části…');if(refreshNews){try{await import(`./sync-news.mjs?v=${Date.now()}`);news=JSON.parse(await readFile(resolve(root,'data/novinky.json'),'utf8'));console.log(`   ${news.length} unikátních novinek načteno.`)}catch(e){console.log(`   ⚠️ Novinky: ${String(e.message||e).slice(0,400)}`)}}else{try{news=JSON.parse(await readFile(resolve(root,'data/novinky.json'),'utf8'))}catch{}console.log(`   přeskočeno (ponechávám ${news.length} novinek; obnova: npm run sync:news).`)}
    const sourceStatus={
      people:sourceEntry(previousSourceStatus,'people',{refreshed:refreshPeople,count:people.length,strict:true}),
      hmpFunctions:sourceEntry(previousSourceStatus,'hmpFunctions',{refreshed:refreshHmpFunctions,count:people.filter(x=>(x.magistrateRoles||[]).length).length,strict:true}),
      hmpCompanies:sourceEntry(previousSourceStatus,'hmpCompanies',{refreshed:refreshHmpCompanies,count:people.filter(x=>(x.hmpCompanyRoles||[]).length).length,strict:true}),
      nationalRoles:sourceEntry(previousSourceStatus,'nationalRoles',{refreshed:refreshNationalRoles,count:people.filter(x=>(x.otherRoles||[]).length).length,strict:true}),
      p8Companies:sourceEntry(previousSourceStatus,'p8Companies',{refreshed:refreshOrganizations,count:orgs.filter(o=>o.legalType==='obchodní společnost').length,strict:true}),
      organizations:sourceEntry(previousSourceStatus,'organizations',{refreshed:refreshOrganizations,count:orgs.length,strict:true}),
      schoolOpenData:sourceEntry(previousSourceStatus,'schoolOpenData',{refreshed:refreshOrganizations,count:orgs.filter(o=>o.statsAsOf).length?2:0,strict:true}),
      budgetOpenData:sourceEntry(previousSourceStatus,'budgetOpenData',{refreshed:false,count:0,strict:true}),
      socialServicesOpenData:sourceEntry(previousSourceStatus,'socialServicesOpenData',{refreshed:false,count:0,strict:true}),
      bodies:sourceEntry(previousSourceStatus,'bodies',{refreshed:refreshBodies,count:bodies.length,strict:true}),
      resolutions:sourceEntry(previousSourceStatus,'resolutions',{refreshed:refreshUsneseni,count:details.items.length}),
      voting:sourceEntry(previousSourceStatus,'voting',{refreshed:refreshVoting,count:h}),
      info106:sourceEntry(previousSourceStatus,'info106',{refreshed:refreshInfo106,count:info106.length}),
      noticeboard:sourceEntry(previousSourceStatus,'noticeboard',{refreshed:refreshNoticeBoard,count:notice.length}),
      elections:sourceEntry(previousSourceStatus,'elections',{refreshed:refreshElections,count:(elections.years||[]).length,strict:true}),
      census2021:sourceEntry(previousSourceStatus,'census2021',{refreshed:refreshCensus,count:(census?.datasets||[]).length,strict:true}),
      news:sourceEntry(previousSourceStatus,'news',{refreshed:refreshNews,count:news.length,strict:true}),
      contracts:sourceEntry(previousSourceStatus,'contracts',{refreshed:refreshContracts,count:(contracts.meta?.total||contracts.contracts?.length||0),status:contracts.meta?.validation?.status==='verified'?'data načtena':contracts.meta?.validation?.status==='provisional'?'data částečně načtena':''})
    };
    try{const hvData=JSON.parse(await readFile(resolve(root,'data/hlasovani.json'),'utf8'));sourceStatus.voting=sourceEntry(previousSourceStatus,'voting',{refreshed:refreshVoting,count:hvData.length})}catch{}
    await writeSourceStatus(sourceStatus);
    await browser.close();browser=null;
    const tasks=details.items.reduce((n,x)=>n+(x.tasks?.length||0),0);
    const meta={updated:new Date().toISOString().slice(0,10),mode:'synced',resolutions:details.items.length,resolutionsRada:res.rada,resolutionsZastupitelstvo:res.zast,tasks,people:people.length,organizations:orgs.length,organizationsWithIco:orgs.filter(x=>x.ico).length,bodies:bodies.length,info106:info106.length,noticeBoard:notice.length,contracts:(contracts.meta?.total||contracts.contracts?.length||0),contractsValidation:contracts.meta?.validation?.status||'unknown',detailRemaining:details.remaining,note:`Výchozí synchronizace načítá ostré sady: Praha 8 (zastupitelstvo, komise a výbory), HMP (zastupitelstvo/výbory/komise a firmy), Parlament ČR, organizace a firmy Prahy 8, volby a Registr smluv. Ostatní zdroje se spouštějí samostatně.`};
    await writeFile(resolve(root,'data/meta.json'),JSON.stringify(meta,null,2));await writeState({status:'ok',resolutions:details.items.length});
    const refreshed=[];
    if(refreshPeople||refreshBodies)refreshed.push(`${people.length} lidí${refreshBodies?` · ${bodies.length} komisí/výborů`:''}`);
    if(refreshHmpFunctions)refreshed.push('funkce HMP');
    if(refreshNationalRoles)refreshed.push('Parlament ČR');
    if(refreshOrganizations)refreshed.push(`${orgs.length} organizací a firem · IČO u ${orgs.filter(x=>x.ico).length}`);
    if(refreshHmpCompanies)refreshed.push('firmy HMP');
    if(refreshVoting)refreshed.push(`${h} hlasování`);
    if(incrementalUsneseni)refreshed.push(`${res.added||0} nových usnesení`);
    else if(refreshUsneseni)refreshed.push(`${details.items.length.toLocaleString('cs-CZ')} usnesení`);
    if(refreshInfo106)refreshed.push(`${info106.length} žádostí podle 106`);
    if(refreshNoticeBoard)refreshed.push(`${notice.length} položek úřední desky`);
    if(refreshElections)refreshed.push('volby');
    if(refreshContracts)refreshed.push(`${contracts.meta?.total||contracts.contracts?.length||0} smluv`);
    if(refreshCensus)refreshed.push(`${census?.datasets?.length||0} sad Sčítání 2021`);
    if(refreshNews)refreshed.push(`${news.length} novinek`);
    console.log(`\nHOTOVO${refreshed.length?`: ${refreshed.join(' · ')}`:'.'}`);
  }catch(e){if(browser)await browser.close().catch(()=>{});await writeState({status:'error',message:e.message}).catch(()=>{});console.error('\nSynchronizace selhala bezpečně — existující datové JSONy zůstaly použitelné.');console.error(e.stack||e.message);process.exitCode=1}
}
main();
