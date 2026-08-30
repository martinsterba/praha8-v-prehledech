import {readFile, writeFile, rename} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import puppeteer from 'puppeteer-core';

const root=resolve(import.meta.dirname,'..');
const DATA=resolve(root,'data','hlasovani.json');
const SOURCES=resolve(root,'data','hlasovani-zdroje.json');
const PAGE='https://www.praha8.cz/Prehledy-hlasovani.html';
const UA='Praha8-v-prehledech/3.0.11 (+public-data-indexer; public sources only)';
const BOOTSTRAP=process.argv.includes('--bootstrap');
const PLAN=process.argv.includes('--plan');
const FIRST=process.argv.includes('--first');

const clean=s=>String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/\s+/g,' ').trim();
const absolute=(href,base)=>new URL(href,base).href;
const isoDate=s=>{const m=String(s||'').match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);return m?`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:''};
async function fetchText(url){const r=await fetch(url,{headers:{'user-agent':UA,'accept':'text/html,*/*'},signal:AbortSignal.timeout(60000)});if(!r.ok)throw new Error(`${r.status} ${url}`);return r.text()}
async function readJson(path,fallback){try{return JSON.parse(await readFile(path,'utf8'))}catch{return fallback}}
async function atomicJson(path,data){const tmp=`${path}.tmp`;await writeFile(tmp,JSON.stringify(data,null,2));await rename(tmp,path)}

function findChrome(){
  const candidates=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge','/Applications/Chromium.app/Contents/MacOS/Chromium',process.env.PUPPETEER_EXECUTABLE_PATH].filter(Boolean);
  const hit=candidates.find(existsSync);
  if(!hit)throw new Error('Nenašel jsem Chrome/Edge. Nainstalujte Chrome nebo nastavte PUPPETEER_EXECUTABLE_PATH.');
  return hit;
}

function exportCandidates(date='',discovered=''){
  const out=[];
  if(discovered)out.push(discovered);
  const m=String(date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(m){
    const [,y,mo,da]=m;
    const modern=`${y}${mo}${da}`;
    const legacy=`${y}${Number(mo)}${Number(da)}`;
    out.push(`https://praha8.cz/podklady_mc/ZMC${modern}audiohlasovani/export/html/`);
    out.push(`https://praha8.cz/podklady_mc/ZMC${legacy}audiohlasovani/export/html/`);
  }
  return [...new Set(out.filter(Boolean))];
}

function discoverSources(html){
  const out=[];
  for(const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
    const title=clean(m[2]);
    if(!/Přehled hlasování zastupitelstva/i.test(title))continue;
    const date=isoDate(title); if(!date)continue;
    out.push({date,title,url:absolute(m[1],PAGE)});
  }
  return [...new Map(out.map(x=>[x.date,x])).values()].sort((a,b)=>b.date.localeCompare(a.date));
}

function normalizeExportBase(url=''){
  const x=String(url||'').replace(/&amp;/g,'&');
  const m=x.match(/^(https?:\/\/[^\s"'<>]+?\/podklady_mc\/[^\s"'<>]+?\/export\/html\/)(?:index\.html)?(?:[?#].*)?$/i);
  return m?.[1]||'';
}

async function discoverExportBase(page,source){
  await page.goto(source.url,{waitUntil:'domcontentloaded',timeout:30000});
  await new Promise(r=>setTimeout(r,250));
  for(const u of page.frames().map(f=>f.url())){const base=normalizeExportBase(u);if(base)return base}
  const candidates=await page.evaluate(()=>{
    const vals=[];
    for(const el of document.querySelectorAll('a,iframe,frame,object,embed'))for(const a of ['href','src','data']){const v=el.getAttribute(a);if(v)vals.push(v)}
    const html=document.documentElement.innerHTML||'';
    for(const m of html.matchAll(/(?:https?:\/\/[^\s"'<>]+|\/[^\s"'<>]+)?podklady_mc\/[^\s"'<>]+?\/export\/html\/(?:index\.html)?/gi))vals.push(m[0]);
    return vals;
  });
  for(const raw of candidates){try{const base=normalizeExportBase(new URL(raw,source.url).href);if(base)return base}catch{}}
  return '';
}

async function baseWorks(page,base){
  try{
    const r=await page.goto(`${base}0001.html`,{waitUntil:'domcontentloaded',timeout:30000});
    if((r?.status()||0)>=400)return false;
    return await page.evaluate(()=>/Výsledek hlasování č\./i.test(document.body?.innerText||''));
  }catch{return false}
}

async function findExportBase(discoveryPage,votePage,source){
  const discovered=await discoverExportBase(discoveryPage,source);
  for(const base of exportCandidates(source.date,discovered)){
    if(await baseWorks(votePage,base))return base;
  }
  return '';
}

async function parseCurrentVote(page,url,source,exportBase){
  const data=await page.evaluate(()=>{
    const text=(document.body?.innerText||'').replace(/\r/g,'');
    const lines=text.split('\n').map(x=>x.trim()).filter(Boolean);
    const titleLine=lines.find(x=>/Výsledek hlasování č\./i.test(x))||'';
    if(!titleLine)return null;
    const head=titleLine.match(/Výsledek hlasování č\.\s*(\d+)\s*-\s*bod č\.\s*([^\s]+)\s*-\s*(.*)/i);
    const total=label=>{const m=text.match(new RegExp(label+'\\s*:\\s*(\\d+)','i'));return m?Number(m[1]):null};
    const votes=[];
    for(const row of document.querySelectorAll('tr')){
      const cells=[...row.querySelectorAll('td,th')].map(x=>x.innerText.trim()).filter(Boolean);
      const vi=cells.findIndex(x=>/^(PRO|PROTI|ZDRŽEL(?:A)? SE|NEHLASOVAL(?:A)?|NEPŘÍTOMEN|NEPŘÍTOMNA)$/i.test(x));
      if(vi<0)continue;
      const name=[...cells.slice(0,vi)].reverse().find(x=>/^[\p{L}.]+(?:\s+[\p{L}.]+)+$/u.test(x) && !/^\d+$/.test(x));
      if(name)votes.push({name,vote:cells[vi]});
    }
    return {titleLine,number:head?Number(head[1]):null,item:head?.[2]||'',title:head?.[3]||'',present:total('PŘÍTOMNÝCH'),for:total('PRO'),against:total('PROTI'),abstained:total('ZDRŽELO SE'),notVoting:total('NEHLASOVALO'),absent:total('NEPŘÍTOMNÝCH'),votes};
  });
  if(!data?.number)return null;
  const complete=[data.present,data.for,data.against,data.abstained,data.notVoting,data.absent].every(Number.isFinite);
  if(!complete)throw new Error(`Hlasování č. ${data.number}: chybí souhrnné počty.`);
  return {...data,date:source.date,url,sourceUrl:source.url,exportUrl:`${exportBase}index.html`};
}

async function crawlSource(discoveryPage,votePage,source){
  const exportBase=await findExportBase(discoveryPage,votePage,source);
  if(!exportBase)throw new Error('nenalezen funkční hlasovací export.');
  console.log(`      zdroj: ${exportBase}`);
  const items=[];
  let misses=0;
  const MAX=250, STOP=5;
  for(let n=1;n<=MAX;n++){
    const url=`${exportBase}${String(n).padStart(4,'0')}.html`;
    let response;
    try{response=await votePage.goto(url,{waitUntil:'domcontentloaded',timeout:30000})}catch(e){throw new Error(`Hlasování ${n}: ${e.message}`)}
    const status=response?.status()||0;
    if(status===404){misses++;if(items.length&&misses>=STOP)break;if(!items.length&&n>=STOP)break;continue}
    if(status>=400)throw new Error(`${status} ${url}`);
    const x=await parseCurrentVote(votePage,url,source,exportBase);
    if(!x){misses++;if(items.length&&misses>=STOP)break;if(!items.length&&n>=STOP)break;continue}
    misses=0;items.push(x);
    console.log(`      #${x.number}${x.item?` · bod ${x.item}`:''} · PRO ${x.for} · PROTI ${x.against} · ZDRŽEL SE ${x.abstained} · NEHLASOVAL ${x.notVoting} · přítomných ${x.present} · jmenovitých ${x.votes.length}`);
  }
  return {items:[...new Map(items.map(x=>[`${x.date}|${x.number}`,x])).values()],exportBase};
}

console.log(`\nHLASOVÁNÍ ZMČ PRAHA 8 — ${BOOTSTRAP?'KOMPLETNÍ BOOTSTRAP':'INKREMENTÁLNÍ SYNC'} — v3.0.11`);
console.log('─────────────────────────────────────────────────────────');
let sources=discoverSources(await fetchText(PAGE));
if(FIRST)sources=sources.slice(0,1);
if(!sources.length)throw new Error('Na stránce Prahy 8 nebyly nalezeny žádné přehledy hlasování.');
const old=await readJson(DATA,[]), oldSources=await readJson(SOURCES,[]);
const known=new Set(oldSources.map(x=>x.date||x.url));
const todo=BOOTSTRAP?sources:sources.filter(x=>!known.has(x.date)&&!known.has(x.url));
console.log(`Zdrojová stránka: ${sources.length} zasedání Zastupitelstva · ke zpracování: ${todo.length}.`);
if(PLAN){console.log(todo.length?todo.map(x=>`  ${x.date} · ${x.url}`).join('\n'):'✅ Žádné nové zasedání.');process.exit(0)}
if(!BOOTSTRAP&&!old.length)throw new Error('Chybí historický základ data/hlasovani.json. Nejdřív spusťte npm run sync:voting:bootstrap.');
if(!todo.length){console.log('✅ Žádné nové zasedání. Existující hlasování zůstala beze změny.');process.exit(0)}

const browser=await puppeteer.launch({headless:true,executablePath:findChrome(),args:['--no-sandbox','--disable-setuid-sandbox'],userAgent:UA});
let fresh=[], processed=[];
try{
  const discoveryPage=await browser.newPage();
  const votePage=await browser.newPage();
  for(let i=0;i<todo.length;i++){
    const s=todo[i]; console.log(`   ${i+1}/${todo.length} ${s.date}`);
    try{
      const {items,exportBase}=await crawlSource(discoveryPage,votePage,s);
      if(!items.length)throw new Error('nenalezeno žádné hlasování.');
      fresh.push(...items); processed.push({...s,exportBase});
      console.log(`      ✅ ${items.length} hlasování · ${items.length} výsledků.`);
    }catch(e){console.log(`      ⚠ zasedání nebylo uloženo: ${e.message}`)}
  }
} finally {await browser.close()}

if(FIRST)process.exit(fresh.length?0:1);
if(!fresh.length)throw new Error('Z žádného zasedání se nepodařilo načíst hlasování. Existující dataset nebyl přepsán.');
const merged=BOOTSTRAP?fresh:[...old,...fresh];
const unique=[...new Map(merged.map(x=>[`${x.date}|${x.number}`,x])).values()].sort((a,b)=>b.date.localeCompare(a.date)||a.number-b.number);
const sourceBase=BOOTSTRAP?processed:[...oldSources,...processed];
const sourceUnique=[...new Map(sourceBase.map(x=>[x.date||x.url,x])).values()].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
await atomicJson(DATA,unique);
await atomicJson(SOURCES,sourceUnique);
console.log(`✅ HOTOVO: ${unique.length.toLocaleString('cs-CZ')} hlasování z ${sourceUnique.length}/${sources.length} úspěšně zpracovaných zasedání Zastupitelstva${BOOTSTRAP?' (historický základ)':''}.`);
if(sourceUnique.length!==sources.length)console.log(`⚠ ${sources.length-sourceUnique.length} zasedání zůstává ke zpracování; nebudou považována za synchronizovaná.`);
