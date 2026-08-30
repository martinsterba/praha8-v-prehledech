import {readFile, writeFile, rename} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const DATA=resolve(root,'data','hlasovani.json');
const SOURCES=resolve(root,'data','hlasovani-zdroje.json');
const PAGE='https://www.praha8.cz/Prehledy-hlasovani.html';
const UA='Praha8-v-prehledech/3.0.6 (+public-data-indexer; public sources only)';
const BOOTSTRAP=process.argv.includes('--bootstrap');
const PLAN=process.argv.includes('--plan');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=s=>String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/\s+/g,' ').trim();
const absolute=(href,base)=>new URL(href,base).href;
const isoDate=s=>{const m=String(s||'').match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);return m?`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:''};
async function fetchText(url,attempts=3){let last;for(let i=1;i<=attempts;i++){try{const r=await fetch(url,{headers:{'user-agent':UA,'accept':'text/html,*/*'},signal:AbortSignal.timeout(60000)});if(!r.ok)throw new Error(`${r.status} ${url}`);return await r.text()}catch(e){last=e;if(i<attempts)await sleep(800*i)}}throw last}
async function readJson(path,fallback){try{return JSON.parse(await readFile(path,'utf8'))}catch{return fallback}}
async function atomicJson(path,data){const tmp=`${path}.tmp`;await writeFile(tmp,JSON.stringify(data,null,2));await rename(tmp,path)}

function exportUrl(date=''){
  const compact=String(date).replaceAll('-','');
  if(!/^\d{8}$/.test(compact))return '';
  return `https://praha8.cz/podklady_mc/ZMC${compact}audiohlasovani/export/html/index.html`;
}

function discoverSources(html){
  const out=[];
  for(const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
    const title=clean(m[2]); if(!/Přehled hlasování zastupitelstva/i.test(title))continue;
    const pageUrl=absolute(m[1],PAGE); const date=isoDate(title);
    if(!date)continue;
    out.push({date,title,url:pageUrl,exportUrl:exportUrl(date)});
  }
  return [...new Map(out.map(x=>[x.date,x])).values()].sort((a,b)=>b.date.localeCompare(a.date));
}

function detailLinks(html,indexUrl){
  const links=[];
  for(const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)){
    const raw=m[1].replace(/&amp;/gi,'&');
    if(!/(?:^|\/)\d{4}\.html?(?:[?#]|$)/i.test(raw))continue;
    try{links.push(absolute(raw,indexUrl))}catch{}
  }
  return [...new Set(links)];
}

function parseDetail(html,url,source){
  const text=clean(html);
  const number=Number((text.match(/Výsledek hlasování\s+č\.\s*(\d+)/i)||[])[1]||0);
  if(!number)return null;
  const item=String((text.match(/bod\s+č\.\s*([^\s-]+(?:\s*[^-]*?)?)\s*-\s*/i)||[])[1]||'').trim();
  let title='';
  const titleMatch=text.match(/Výsledek hlasování\s+č\.\s*\d+\s*-\s*bod\s+č\.\s*[^-]*?\s*-\s*([\s\S]*?)(?=\s*\(Pozn|\s*Zasedání č\.|\s*PŘÍTOMNÝCH\s*:)/i);
  if(titleMatch)title=titleMatch[1].trim();
  const date=isoDate((text.match(/(?:Dne|Konaného dne)\s+(\d{1,2}\.\d{1,2}\.\d{4})/i)||[])[1])||source.date;
  const n=label=>{const m=text.match(new RegExp(`${label}\\s*:\\s*(\\d+)`,'i'));return m?Number(m[1]):null};
  return {
    date,number,item,title,
    present:n('PŘÍTOMNÝCH'),
    for:n('PRO'),
    against:n('PROTI'),
    abstained:n('ZDRŽELO SE'),
    notVoting:n('NEHLASOVALO'),
    absent:n('NEPŘÍTOMNÝCH'),
    url,sourceUrl:source.url,exportUrl:source.exportUrl
  };
}

async function crawlSource(source){
  // Ověřená struktura, kterou už web používal: každý zveřejněný přehled má
  // přímý BitEST/H.E.R. export podle data zasedání.
  const indexHtml=await fetchText(source.exportUrl);
  const links=detailLinks(indexHtml,source.exportUrl);
  if(!links.length)throw new Error(`Export ${source.exportUrl} neobsahuje odkazy na jednotlivá hlasování.`);
  const items=[];
  for(let i=0;i<links.length;i++){
    try{
      const x=parseDetail(await fetchText(links[i]),links[i],source);
      if(x)items.push(x);
      else console.log(`      ⚠ nerozpoznáno: ${links[i]}`);
    }catch(e){console.log(`      ⚠ ${links[i]}: ${e.message}`)}
    if((i+1)%25===0)console.log(`      ${i+1}/${links.length} hlasování…`);
  }
  return [...new Map(items.map(x=>[`${x.date}|${x.number}`,x])).values()];
}

console.log(`\nHLASOVÁNÍ ZMČ PRAHA 8 — ${BOOTSTRAP?'KOMPLETNÍ BOOTSTRAP':'INKREMENTÁLNÍ SYNC'} — v3.0.6`);
console.log('────────────────────────────────────────────────────────');
const pageHtml=await fetchText(PAGE); const sources=discoverSources(pageHtml);
if(!sources.length)throw new Error('Na stránce Prahy 8 nebyly nalezeny žádné přehledy hlasování.');
const old=await readJson(DATA,[]); const oldSources=await readJson(SOURCES,[]); const known=new Set(oldSources.map(x=>x.date||x.url));
const todo=BOOTSTRAP?sources:sources.filter(x=>!known.has(x.date)&&!known.has(x.url));
console.log(`Zdrojová stránka: ${sources.length} zasedání Zastupitelstva · ke zpracování: ${todo.length}.`);
if(PLAN){console.log(todo.length?todo.map(x=>`  ${x.date} · ${x.exportUrl}`).join('\n'):'✅ Žádné nové zasedání.');process.exit(0)}
if(!BOOTSTRAP && !old.length)throw new Error('Chybí historický základ data/hlasovani.json. Nejdřív spusťte npm run sync:voting:bootstrap.');
if(!todo.length){console.log('✅ Žádné nové zasedání. Existující hlasování zůstala beze změny.');process.exit(0)}
let fresh=[]; const processed=[];
for(let i=0;i<todo.length;i++){
  const s=todo[i]; console.log(`   ${i+1}/${todo.length} ${s.date}`);
  try{
    const items=await crawlSource(s);
    if(!items.length)throw new Error('export neobsahuje rozpoznatelné hlasování');
    fresh.push(...items); processed.push(s); console.log(`      nalezeno ${items.length} hlasování.`);
  }catch(e){console.log(`      ⚠ zasedání nebylo uloženo: ${e.message}`)}
}
if(!fresh.length)throw new Error('Z žádného zasedání se nepodařilo načíst hlasování. Existující dataset nebyl přepsán.');
const merged=BOOTSTRAP?fresh:[...old,...fresh];
const unique=[...new Map(merged.map(x=>[`${x.date}|${x.number}`,x])).values()].sort((a,b)=>b.date.localeCompare(a.date)||a.number-b.number);
const sourceBase=BOOTSTRAP?processed:[...oldSources,...processed];
const sourceUnique=[...new Map(sourceBase.map(x=>[x.date||x.url,x])).values()].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
await atomicJson(DATA,unique); await atomicJson(SOURCES,sourceUnique);
console.log(`✅ HOTOVO: ${unique.length.toLocaleString('cs-CZ')} hlasování z ${sourceUnique.length}/${sources.length} úspěšně zpracovaných zasedání Zastupitelstva${BOOTSTRAP?' (historický základ)':''}.`);
if(sourceUnique.length!==sources.length)console.log(`⚠ ${sources.length-sourceUnique.length} zasedání zůstává ke zpracování; nebudou považována za synchronizovaná.`);
