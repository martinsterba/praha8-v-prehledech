import {readFile, writeFile, rename} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const DATA=resolve(root,'data','hlasovani.json');
const SOURCES=resolve(root,'data','hlasovani-zdroje.json');
const PAGE='https://www.praha8.cz/Prehledy-hlasovani.html';
const UA='Praha8-v-prehledech/3.0.9 (+public-data-indexer; public sources only)';
const BOOTSTRAP=process.argv.includes('--bootstrap');
const PLAN=process.argv.includes('--plan');
const FIRST=process.argv.includes('--first');

function decodeEntities(s=''){
  const named={nbsp:' ',amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'};
  return String(s)
    .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)))
    .replace(/&([a-z]+);/gi,(m,n)=>named[n.toLowerCase()] ?? m);
}
function clean(s=''){
  return decodeEntities(String(s))
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<br\s*\/?\s*>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}
const absolute=(href,base)=>new URL(href,base).href;
const isoDate=s=>{const m=String(s||'').match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);return m?`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:''};
const fold=s=>String(s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toUpperCase();

function decodeHtml(bytes,contentType=''){
  const probe=new TextDecoder('latin1').decode(bytes.slice(0,4096));
  const declared=(contentType.match(/charset\s*=\s*([^;\s]+)/i)?.[1] || probe.match(/charset\s*=\s*["']?([^"'\s;>]+)/i)?.[1] || '').toLowerCase();
  let enc='utf-8';
  if(/windows-?1250|cp1250|x-cp1250/.test(declared))enc='windows-1250';
  else if(/iso-8859-2|latin2/.test(declared))enc='iso-8859-2';
  try{return new TextDecoder(enc).decode(bytes)}catch{return new TextDecoder('utf-8').decode(bytes)}
}
async function requestHtml(url,{optional=false}={}){
  const r=await fetch(url,{headers:{'user-agent':UA,'accept':'text/html,*/*'},signal:AbortSignal.timeout(60000)});
  if(optional && r.status===404)return null;
  if(!r.ok)throw new Error(`${r.status} ${url}`);
  const bytes=new Uint8Array(await r.arrayBuffer());
  return decodeHtml(bytes,r.headers.get('content-type')||'');
}
const fetchText=url=>requestHtml(url);
const fetchOptional=url=>requestHtml(url,{optional:true});
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
    const title=clean(m[2]);
    if(!/Přehled hlasování zastupitelstva/i.test(title))continue;
    const date=isoDate(title); if(!date)continue;
    out.push({date,title,url:absolute(m[1],PAGE),exportBase:exportBase(date)});
  }
  return [...new Map(out.map(x=>[x.date,x])).values()].sort((a,b)=>b.date.localeCompare(a.date));
}

function rowCells(html){
  const rows=[];
  for(const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
    const cells=[...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(x=>clean(x[1])).filter(Boolean);
    if(cells.length)rows.push(cells);
  }
  return rows;
}
function parseVotes(html){
  const votes=[];
  for(const cells of rowCells(html)){
    const vi=cells.findIndex(c=>/^(PRO|PROTI|ZDRZEL(?:A)? SE|NEHLASOVAL(?:A)?|NEPRITOMEN|NEPRITOMNA)$/i.test(fold(c)));
    if(vi<0)continue;
    const vote=cells[vi];
    const before=cells.slice(0,vi);
    const name=before.reverse().find(c=>/\p{L}{2,}\s+\p{L}{2,}/u.test(c) && !/^\d+$/.test(c) && !/^(ODS|ANO|CESKA|SPOLECNE|PATRIOTI|SPD|8ZIJE)/i.test(fold(c)));
    if(name)votes.push({name,vote});
  }
  return [...new Map(votes.map(v=>[v.name,v])).values()];
}
function total(text,label){
  const f=fold(text);
  const m=f.match(new RegExp(`${label}\\s*:\\s*(\\d+)`));
  return m?Number(m[1]):null;
}
function parseDetail(html,url,source){
  const text=clean(html);
  const ftext=fold(text);
  const fileNumber=Number((url.match(/\/(\d{4})\.html(?:\?|$)/i)||[])[1]||0);
  const headingNumber=Number((ftext.match(/VYSLEDEK\s+HLASOVANI\s+C\.\s*(\d+)/i)||[])[1]||0);
  const number=headingNumber||fileNumber;
  if(!number)return null;
  const head=text.match(/Výsledek\s+hlasování\s+č\.\s*\d+\s*-\s*bod\s+č\.\s*([^\s-]+)\s*-\s*([\s\S]*?)(?=\s*\(Poznámka:|\s*Zasedání č\.)/i);
  const item=String(head?.[1]||'').trim();
  const title=String(head?.[2]||'').trim();
  const date=isoDate((text.match(/\bDne\s+(\d{1,2}\.\d{1,2}\.\d{4})/i)||[])[1])||source.date;
  return {
    date,number,item,title,
    present:total(text,'PRITOMNYCH'),
    for:total(text,'PRO'),
    against:total(text,'PROTI'),
    abstained:total(text,'ZDRZELO SE'),
    notVoting:total(text,'NEHLASOVALO'),
    absent:total(text,'NEPRITOMNYCH'),
    votes:parseVotes(html),
    url,sourceUrl:source.url,exportUrl:`${source.exportBase}index.html`
  };
}
async function crawlSource(source){
  const items=[]; let misses=0; const MAX=250, STOP=5;
  for(let n=1;n<=MAX;n++){
    const url=`${source.exportBase}${String(n).padStart(4,'0')}.html`;
    const html=await fetchOptional(url);
    if(html===null){misses++; if(items.length&&misses>=STOP)break; if(!items.length&&n>=STOP)break; continue;}
    misses=0;
    const x=parseDetail(html,url,source);
    if(x)items.push(x);
    if(n===1 && x){
      console.log(`      diagnostika 0001: číslo ${x.number}, bod ${x.item||'—'}, pro ${x.for ?? '—'}, proti ${x.against ?? '—'}, zdrželo ${x.abstained ?? '—'}, přítomných ${x.present ?? '—'}, jmenovitých hlasů ${x.votes.length}`);
      if(x.votes.length)console.log(`      první hlas: ${x.votes[0].name} → ${x.votes[0].vote}`);
    }
    if(n%25===0)console.log(`      prověřeno ${n} čísel · nalezeno ${items.length} hlasování…`);
  }
  return [...new Map(items.map(x=>[`${x.date}|${x.number}`,x])).values()];
}

console.log(`\nHLASOVÁNÍ ZMČ PRAHA 8 — ${BOOTSTRAP?'KOMPLETNÍ BOOTSTRAP':'INKREMENTÁLNÍ SYNC'} — v3.0.9`);
console.log('────────────────────────────────────────────────────────');
let sources=discoverSources(await fetchText(PAGE));
if(FIRST)sources=sources.slice(0,1);
if(!sources.length)throw new Error('Na stránce Prahy 8 nebyly nalezeny žádné přehledy hlasování.');
const old=await readJson(DATA,[]), oldSources=await readJson(SOURCES,[]);
const known=new Set(oldSources.map(x=>x.date||x.url));
const todo=BOOTSTRAP?sources:sources.filter(x=>!known.has(x.date)&&!known.has(x.url));
console.log(`Zdrojová stránka: ${sources.length} zasedání Zastupitelstva · ke zpracování: ${todo.length}.`);
if(PLAN){console.log(todo.length?todo.map(x=>`  ${x.date} · ${x.exportBase}`).join('\n'):'✅ Žádné nové zasedání.');process.exit(0)}
let fresh=[], processed=[];
for(let i=0;i<todo.length;i++){
  const s=todo[i]; console.log(`   ${i+1}/${todo.length} ${s.date}`);
  try{
    const items=await crawlSource(s);
    if(!items.length)throw new Error(`nenalezeno žádné hlasování na ${s.exportBase}NNNN.html`);
    fresh.push(...items); processed.push(s); console.log(`      ✅ nalezeno ${items.length} hlasování.`);
  }catch(e){console.log(`      ⚠ zasedání nebylo uloženo: ${e.message}`)}
}
if(FIRST)process.exit(fresh.length?0:1);
if(!fresh.length)throw new Error('Z žádného zasedání se nepodařilo načíst hlasování. Existující dataset nebyl přepsán.');
const merged=BOOTSTRAP?fresh:[...old,...fresh];
const unique=[...new Map(merged.map(x=>[`${x.date}|${x.number}`,x])).values()].sort((a,b)=>b.date.localeCompare(a.date)||a.number-b.number);
const sourceUnique=[...new Map((BOOTSTRAP?processed:[...oldSources,...processed]).map(x=>[x.date||x.url,x])).values()].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
await atomicJson(DATA,unique); await atomicJson(SOURCES,sourceUnique);
console.log(`✅ HOTOVO: ${unique.length.toLocaleString('cs-CZ')} hlasování z ${sourceUnique.length}/${sources.length} zasedání.`);
