import {readFile, writeFile, rename} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const DATA=resolve(root,'data','hlasovani.json');
const SOURCES=resolve(root,'data','hlasovani-zdroje.json');
const PAGE='https://www.praha8.cz/Prehledy-hlasovani.html';
const UA='Praha8-v-prehledech/3.0.4 (+public-data-indexer; public sources only)';
const BOOTSTRAP=process.argv.includes('--bootstrap');
const PLAN=process.argv.includes('--plan');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=s=>String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/\s+/g,' ').trim();
const absolute=(href,base)=>new URL(href,base).href;
const isoDate=s=>{const m=String(s||'').match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);return m?`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:''};
async function fetchText(url,attempts=3){let last;for(let i=1;i<=attempts;i++){try{const r=await fetch(url,{headers:{'user-agent':UA,'accept':'text/html,*/*'},signal:AbortSignal.timeout(60000)});if(!r.ok)throw new Error(`${r.status} ${url}`);return await r.text()}catch(e){last=e;if(i<attempts)await sleep(800*i)}}throw last}
async function readJson(path,fallback){try{return JSON.parse(await readFile(path,'utf8'))}catch{return fallback}}
async function atomicJson(path,data){const tmp=`${path}.tmp`;await writeFile(tmp,JSON.stringify(data,null,2));await rename(tmp,path)}
function discoverSources(html){
  const out=[];
  for(const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
    const title=clean(m[2]); if(!/Přehled hlasování zastupitelstva/i.test(title))continue;
    const url=absolute(m[1],PAGE); const date=isoDate(title)||isoDate(url.replace(/ZMC(\d{4})(\d{2})(\d{2})/i,'$3.$2.$1'));
    out.push({date,title,url});
  }
  return [...new Map(out.map(x=>[x.url,x])).values()].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
}
function detailLinks(html,indexUrl){
  const links=[];
  for(const m of html.matchAll(/href=["']([^"']+\.html(?:\?[^"']*)?)["']/gi)){
    const u=absolute(m[1],indexUrl); if(/\/\d{4}\.html(?:\?|$)/i.test(u))links.push(u);
  }
  return [...new Set(links)];
}
function parseDetail(html,url,source){
  const text=clean(html);
  const head=text.match(/Výsledek hlasování\s+č\.\s*(\d+)\s*-\s*bod\s+č\.\s*([^.-]+(?:\.[^ -]*)?)\s*-\s*([\s\S]*?)(?=\s*\(Poznámka:|\s*Zasedání č\.)/i);
  const number=Number(head?.[1]||0); if(!number)return null;
  const item=String(head?.[2]||'').trim(); const title=String(head?.[3]||'').trim();
  const date=isoDate((text.match(/\bDne\s+(\d{1,2}\.\d{1,2}\.\d{4})/i)||[])[1])||source.date;
  const n=label=>{const m=text.match(new RegExp(`${label}\\s*:\\s*(\\d+)`,'i'));return m?Number(m[1]):null};
  const present=n('PŘÍTOMNÝCH'); const absent=n('NEPŘÍTOMNÝCH'); const pro=n('PRO'); const proti=n('PROTI'); const abstained=n('ZDRŽELO SE'); const notVoting=n('NEHLASOVALO');
  return {date,number,item,title,present,for:pro,against:proti,abstained,notVoting,absent,url,sourceUrl:source.url};
}
async function crawlSource(source){
  const indexHtml=await fetchText(source.url); let links=detailLinks(indexHtml,source.url);
  // Některé starší exporty mají odkazy relativně a některé indexy je skrývají v tabulce.
  if(!links.length){
    const nums=[...indexHtml.matchAll(/(?:href=["'][^"']*)?(\d{4})\.html/gi)].map(m=>absolute(`${m[1]}.html`,source.url));
    links=[...new Set(nums)];
  }
  const items=[];
  for(let i=0;i<links.length;i++){
    try{const x=parseDetail(await fetchText(links[i]),links[i],source);if(x)items.push(x)}catch(e){console.log(`      ⚠ ${links[i]}: ${e.message}`)}
    if((i+1)%25===0)console.log(`      ${i+1}/${links.length} hlasování…`);
  }
  return items;
}

console.log(`\nHLASOVÁNÍ ZMČ PRAHA 8 — ${BOOTSTRAP?'KOMPLETNÍ BOOTSTRAP':'INKREMENTÁLNÍ SYNC'} — v3.0.4`);
console.log('────────────────────────────────────────────────────────');
const pageHtml=await fetchText(PAGE); const sources=discoverSources(pageHtml);
if(!sources.length)throw new Error('Na stránce Prahy 8 nebyly nalezeny žádné přehledy hlasování.');
const old=await readJson(DATA,[]); const oldSources=await readJson(SOURCES,[]); const known=new Set(oldSources.map(x=>x.url));
const todo=BOOTSTRAP?sources:sources.filter(x=>!known.has(x.url));
console.log(`Zdrojová stránka: ${sources.length} zasedání · ke zpracování: ${todo.length}.`);
if(PLAN){console.log(todo.length?todo.map(x=>`  ${x.date} · ${x.url}`).join('\n'):'✅ Žádné nové zasedání.');process.exit(0)}
if(!BOOTSTRAP && !old.length)throw new Error('Chybí historický základ data/hlasovani.json. Nejdřív spusťte npm run sync:voting:bootstrap.');
if(!todo.length){console.log('✅ Žádné nové zasedání. Existující hlasování zůstala beze změny.');process.exit(0)}
let fresh=[];
for(let i=0;i<todo.length;i++){
  const s=todo[i]; console.log(`   ${i+1}/${todo.length} ${s.date||s.title}`); const items=await crawlSource(s); fresh.push(...items); console.log(`      nalezeno ${items.length} hlasování.`);
}
const merged=BOOTSTRAP?fresh:[...old,...fresh];
const unique=[...new Map(merged.map(x=>[`${x.date}|${x.number}|${x.url}`,x])).values()].sort((a,b)=>(b.date||'').localeCompare(a.date||'')||a.number-b.number);
await atomicJson(DATA,unique); await atomicJson(SOURCES,sources);
console.log(`✅ HOTOVO: ${unique.length.toLocaleString('cs-CZ')} hlasování z ${sources.length} zasedání${BOOTSTRAP?' (kompletní základ)':''}.`);
