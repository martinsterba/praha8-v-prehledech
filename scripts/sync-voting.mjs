import {readFile, writeFile, rename} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const DATA=resolve(root,'data','hlasovani.json');
const SOURCES=resolve(root,'data','hlasovani-zdroje.json');
const PAGE='https://www.praha8.cz/Prehledy-hlasovani.html';
const UA='Praha8-v-prehledech/3.0.7 (+public-data-indexer; public sources only)';
const BOOTSTRAP=process.argv.includes('--bootstrap');
const PLAN=process.argv.includes('--plan');
const clean=s=>String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/\s+/g,' ').trim();
const absolute=(href,base)=>new URL(href,base).href;
const isoDate=s=>{const m=String(s||'').match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);return m?`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:''};
async function fetchText(url){const r=await fetch(url,{headers:{'user-agent':UA,'accept':'text/html,*/*'},signal:AbortSignal.timeout(60000)});if(!r.ok)throw new Error(`${r.status} ${url}`);return r.text()}
async function fetchOptional(url){const r=await fetch(url,{headers:{'user-agent':UA,'accept':'text/html,*/*'},signal:AbortSignal.timeout(60000)});if(r.status===404)return null;if(!r.ok)throw new Error(`${r.status} ${url}`);return r.text()}
async function readJson(path,fallback){try{return JSON.parse(await readFile(path,'utf8'))}catch{return fallback}}
async function atomicJson(path,data){const tmp=`${path}.tmp`;await writeFile(tmp,JSON.stringify(data,null,2));await rename(tmp,path)}

function exportBase(date=''){
  const compact=String(date).replaceAll('-','');
  if(!/^\d{8}$/.test(compact))return '';
  return `https://praha8.cz/podklady_mc/ZMC${compact}audiohlasovani/export/html/`;
}

function discoverSources(html){
  const out=[];
  for(const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
    const title=clean(m[2]); if(!/Přehled hlasování zastupitelstva/i.test(title))continue;
    const pageUrl=absolute(m[1],PAGE); const date=isoDate(title);
    if(!date)continue;
    out.push({date,title,url:pageUrl,exportBase:exportBase(date)});
  }
  return [...new Map(out.map(x=>[x.date,x])).values()].sort((a,b)=>b.date.localeCompare(a.date));
}

function parseVotes(html){
  const votes=[];
  for(const m of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
    const cells=[...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(x=>clean(x[1]));
    if(cells.length<3)continue;
    const voteIndex=cells.findIndex(c=>/^(PRO|PROTI|ZDRŽEL(?:A)? SE|NEHLASOVAL(?:A)?|NEPŘÍTOMEN|NEPŘÍTOMNA)$/i.test(c));
    if(voteIndex<0)continue;
    const name=cells.slice(0,voteIndex).reverse().find(c=>/[A-Za-zÁ-ž]{2,}\s+[A-Za-zÁ-ž]{2,}/u.test(c) && !/^(ODS|ANO|Česká|Společně|PATRIOTI|SPD|8ŽIJE)/i.test(c));
    if(!name)continue;
    votes.push({name,vote:cells[voteIndex]});
  }
  return votes;
}

function parseDetail(html,url,source){
  const text=clean(html);
  const number=Number((text.match(/Výsledek hlasování\s+č\.\s*(\d+)/i)||[])[1]||0);
  if(!number)return null;
  const head=text.match(/Výsledek hlasování\s+č\.\s*\d+\s*-\s*bod\s+č\.\s*([^\s-]+)\s*-\s*([\s\S]*?)(?=\s*\(Poznámka:|\s*Zasedání č\.)/i);
  const item=String(head?.[1]||'').trim();
  const title=String(head?.[2]||'').trim();
  const date=isoDate((text.match(/\bDne\s+(\d{1,2}\.\d{1,2}\.\d{4})/i)||[])[1])||source.date;
  const n=label=>{const m=text.match(new RegExp(`${label}\\s*:\\s*(\\d+)`,'i'));return m?Number(m[1]):null};
  return {
    date,number,item,title,
    present:n('PŘÍTOMNÝCH'),
    for:n('PRO'),
    against:n('PROTI'),
    abstained:n('ZDRŽELO SE'),
    notVoting:n('NEHLASOVALO'),
    absent:n('NEPŘÍTOMNÝCH'),
    votes:parseVotes(html),
    url,sourceUrl:source.url,exportUrl:`${source.exportBase}index.html`
  };
}

async function crawlSource(source){
  // BitEST export má jednotlivá hlasování na stabilních adresách 0001.html,
  // 0002.html, ... Index nemusí obsahovat klasické <a href>, proto na něm
  // nejsme závislí a číslované detaily čteme přímo.
  const items=[];
  let misses=0;
  const MAX=250;
  const STOP_AFTER_MISSES=5;
  for(let number=1;number<=MAX;number++){
    const url=`${source.exportBase}${String(number).padStart(4,'0')}.html`;
    let html;
    try{html=await fetchOptional(url)}catch(e){throw new Error(`Hlasování ${number}: ${e.message}`)}
    if(html===null){
      misses++;
      if(items.length && misses>=STOP_AFTER_MISSES)break;
      if(!items.length && number>=STOP_AFTER_MISSES)break;
      continue;
    }
    misses=0;
    const x=parseDetail(html,url,source);
    if(x)items.push(x);
    if(number%25===0)console.log(`      prověřeno ${number} čísel · nalezeno ${items.length} hlasování…`);
  }
  return [...new Map(items.map(x=>[`${x.date}|${x.number}`,x])).values()];
}

console.log(`\nHLASOVÁNÍ ZMČ PRAHA 8 — ${BOOTSTRAP?'KOMPLETNÍ BOOTSTRAP':'INKREMENTÁLNÍ SYNC'} — v3.0.7`);
console.log('────────────────────────────────────────────────────────');
const pageHtml=await fetchText(PAGE); const sources=discoverSources(pageHtml);
if(!sources.length)throw new Error('Na stránce Prahy 8 nebyly nalezeny žádné přehledy hlasování.');
const old=await readJson(DATA,[]); const oldSources=await readJson(SOURCES,[]); const known=new Set(oldSources.map(x=>x.date||x.url));
const todo=BOOTSTRAP?sources:sources.filter(x=>!known.has(x.date)&&!known.has(x.url));
console.log(`Zdrojová stránka: ${sources.length} zasedání Zastupitelstva · ke zpracování: ${todo.length}.`);
if(PLAN){console.log(todo.length?todo.map(x=>`  ${x.date} · ${x.exportBase}`).join('\n'):'✅ Žádné nové zasedání.');process.exit(0)}
if(!BOOTSTRAP && !old.length)throw new Error('Chybí historický základ data/hlasovani.json. Nejdřív spusťte npm run sync:voting:bootstrap.');
if(!todo.length){console.log('✅ Žádné nové zasedání. Existující hlasování zůstala beze změny.');process.exit(0)}
let fresh=[]; const processed=[];
for(let i=0;i<todo.length;i++){
  const s=todo[i]; console.log(`   ${i+1}/${todo.length} ${s.date}`);
  try{
    const items=await crawlSource(s);
    if(!items.length)throw new Error(`nenalezeno žádné hlasování na ${s.exportBase}NNNN.html`);
    fresh.push(...items); processed.push(s); console.log(`      ✅ nalezeno ${items.length} hlasování.`);
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
