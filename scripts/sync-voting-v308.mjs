import {readFile, writeFile, rename} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const DATA=resolve(root,'data','hlasovani.json');
const SOURCES=resolve(root,'data','hlasovani-zdroje.json');
const PAGE='https://www.praha8.cz/Prehledy-hlasovani.html';
const UA='Praha8-v-prehledech/3.0.8 (+public-data-indexer; public sources only)';
const BOOTSTRAP=process.argv.includes('--bootstrap');
const PLAN=process.argv.includes('--plan');

const clean=s=>String(s||'')
  .replace(/<script[\s\S]*?<\/script>/gi,' ')
  .replace(/<style[\s\S]*?<\/style>/gi,' ')
  .replace(/<[^>]+>/g,' ')
  .replace(/&nbsp;|&#160;/gi,' ')
  .replace(/&amp;/gi,'&')
  .replace(/&quot;/gi,'"')
  .replace(/&#39;|&apos;/gi,"'")
  .replace(/\s+/g,' ')
  .trim();
const absolute=(href,base)=>new URL(href,base).href;
const isoDate=s=>{const m=String(s||'').match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);return m?`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:''};

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

function parseVotes(html){
  const votes=[];
  for(const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
    const cells=[...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(x=>clean(x[1]));
    if(cells.length<3)continue;
    const vi=cells.findIndex(c=>/^(PRO|PROTI|ZDRŽEL(?:A)? SE|NEHLASOVAL(?:A)?|NEPŘÍTOMEN|NEPŘÍTOMNA)$/i.test(c));
    if(vi<0)continue;
    const name=cells.slice(0,vi).reverse().find(c=>/[A-Za-zÁ-ž]{2,}\s+[A-Za-zÁ-ž]{2,}/u.test(c) && !/^(ODS|ANO|Česká|Společně|PATRIOTI|SPD|8ŽIJE)/i.test(c));
    if(name)votes.push({name,vote:cells[vi]});
  }
  return [...new Map(votes.map(v=>[v.name,v])).values()];
}

function parseDetail(html,url,source){
  const text=clean(html);
  const fileNumber=Number((url.match(/\/(\d{4})\.html(?:\?|$)/i)||[])[1]||0);
  const headingNumber=Number((text.match(/Výsledek\s+hlasování\s+č\.\s*(\d+)/i)||[])[1]||0);
  const number=headingNumber||fileNumber;
  if(!number)return null;

  const head=text.match(/Výsledek\s+hlasování\s+č\.\s*\d+\s*-\s*bod\s+č\.\s*([^\s-]+)\s*-\s*([\s\S]*?)(?=\s*\(Poznámka:|\s*Zasedání č\.)/i);
  const item=String(head?.[1]||'').trim();
  const title=String(head?.[2]||'').trim();
  const date=isoDate((text.match(/\bDne\s+(\d{1,2}\.\d{1,2}\.\d{4})/i)||[])[1])||source.date;
  const n=pattern=>{const m=text.match(pattern);return m?Number(m[1]):null};

  return {
    date,number,item,title,
    present:n(/PŘÍTOMN(?:Ý|Y)CH\s*:\s*(\d+)/i),
    for:n(/(?:^|\s)PRO\s*:\s*(\d+)/i),
    against:n(/PROTI\s*:\s*(\d+)/i),
    abstained:n(/ZDRŽELO\s+SE\s*:\s*(\d+)/i),
    notVoting:n(/NEHLASOVALO\s*:\s*(\d+)/i),
    absent:n(/NEPŘÍTOMN(?:Ý|Y)CH\s*:\s*(\d+)/i),
    votes:parseVotes(html),
    url,sourceUrl:source.url,exportUrl:`${source.exportBase}index.html`
  };
}

async function crawlSource(source){
  const items=[];
  let misses=0;
  const MAX=250, STOP=5;
  for(let n=1;n<=MAX;n++){
    const url=`${source.exportBase}${String(n).padStart(4,'0')}.html`;
    const html=await fetchOptional(url);
    if(html===null){
      misses++;
      if(items.length && misses>=STOP)break;
      if(!items.length && n>=STOP)break;
      continue;
    }
    misses=0;
    const x=parseDetail(html,url,source);
    if(x)items.push(x);
    if(n===1 && x)console.log(`      diagnostika 0001: číslo ${x.number}, pro ${x.for ?? '—'}, přítomných ${x.present ?? '—'}, jmenovitých hlasů ${x.votes.length}`);
    if(n%25===0)console.log(`      prověřeno ${n} čísel · nalezeno ${items.length} hlasování…`);
  }
  return [...new Map(items.map(x=>[`${x.date}|${x.number}`,x])).values()];
}

console.log(`\nHLASOVÁNÍ ZMČ PRAHA 8 — ${BOOTSTRAP?'KOMPLETNÍ BOOTSTRAP':'INKREMENTÁLNÍ SYNC'} — v3.0.8`);
console.log('────────────────────────────────────────────────────────');
const sources=discoverSources(await fetchText(PAGE));
if(!sources.length)throw new Error('Na stránce Prahy 8 nebyly nalezeny žádné přehledy hlasování.');
const old=await readJson(DATA,[]), oldSources=await readJson(SOURCES,[]);
const known=new Set(oldSources.map(x=>x.date||x.url));
const todo=BOOTSTRAP?sources:sources.filter(x=>!known.has(x.date)&&!known.has(x.url));
console.log(`Zdrojová stránka: ${sources.length} zasedání Zastupitelstva · ke zpracování: ${todo.length}.`);
if(PLAN){console.log(todo.length?todo.map(x=>`  ${x.date} · ${x.exportBase}`).join('\n'):'✅ Žádné nové zasedání.');process.exit(0)}
if(!BOOTSTRAP && !old.length)throw new Error('Chybí historický základ data/hlasovani.json.');

let fresh=[], processed=[];
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
const sourceUnique=[...new Map((BOOTSTRAP?processed:[...oldSources,...processed]).map(x=>[x.date||x.url,x])).values()].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
await atomicJson(DATA,unique); await atomicJson(SOURCES,sourceUnique);
console.log(`✅ HOTOVO: ${unique.length.toLocaleString('cs-CZ')} hlasování z ${sourceUnique.length}/${sources.length} zasedání.`);
