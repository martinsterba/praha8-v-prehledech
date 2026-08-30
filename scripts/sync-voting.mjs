import {readFile, writeFile, rename} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const DATA=resolve(root,'data','hlasovani.json');
const SOURCES=resolve(root,'data','hlasovani-zdroje.json');
const PAGE='https://www.praha8.cz/Prehledy-hlasovani.html';
const UA='Praha8-v-prehledech/3.0.5 (+public-data-indexer; public sources only)';
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
function candidateUrls(raw,indexUrl){
  const href=String(raw||'').replace(/&amp;/gi,'&').trim();
  if(!href)return [];
  const out=[];
  try{out.push(absolute(href,indexUrl))}catch{}
  // Exporty hlasování jsou často vložené přes iframe a relativní cesty se vztahují
  // k adresáři exportu, ne ke kořeni praha8.cz. Proto zachováme i cestu odvozenou
  // z adresy samotného exportu, pokud ji HTML obsahuje bez úvodního lomítka.
  const dir=String(indexUrl).replace(/[^/]*(?:\?.*)?$/,'');
  if(!/^https?:/i.test(href) && !href.startsWith('/')){
    try{out.push(new URL(href,dir).href)}catch{}
  }
  return [...new Set(out)];
}
function detailLinks(html,indexUrl){
  const links=[];
  // Bereme jen skutečné hodnoty href/src. Původní fallback zachytil rok z libovolného
  // textu stránky (např. „2025.html“) a vytvořil falešné https://www.praha8.cz/2025.html.
  for(const m of html.matchAll(/(?:href|src)\s*=\s*["']([^"']+)["']/gi)){
    const raw=m[1];
    if(!/\.html?(?:[?#]|$)/i.test(raw))continue;
    for(const u of candidateUrls(raw,indexUrl)){
      if(/(?:^|\/)\d{4}\.html?(?:[?#]|$)/i.test(new URL(u).pathname+new URL(u).search) || /hlasov|vote|zmc/i.test(u))links.push(u);
    }
  }
  return [...new Set(links)].filter(u=>u!==indexUrl);
}
function embeddedExportLinks(html,indexUrl){
  const out=[];
  // Stránka Prahy 8 je obal; vlastní hlasovací export bývá v iframe/object/embed.
  for(const m of html.matchAll(/<(?:iframe|frame|embed|object)\b[^>]*(?:src|data)\s*=\s*["']([^"']+)["']/gi)){
    for(const u of candidateUrls(m[1],indexUrl))out.push(u);
  }
  return [...new Set(out)];
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
  const wrapperHtml=await fetchText(source.url);
  const exportLinks=embeddedExportLinks(wrapperHtml,source.url);
  const pages=exportLinks.length?exportLinks:[source.url];
  let links=[];
  for(const pageUrl of pages){
    try{
      const html=pageUrl===source.url?wrapperHtml:await fetchText(pageUrl);
      const direct=parseDetail(html,pageUrl,source);
      if(direct)links.push(pageUrl);
      links.push(...detailLinks(html,pageUrl));
    }catch(e){console.log(`      ⚠ export ${pageUrl}: ${e.message}`)}
  }
  links=[...new Set(links)];
  if(!links.length)throw new Error(`Zasedání ${source.date||source.title}: nenalezen odkaz na hlasovací export.`);
  const items=[];
  for(let i=0;i<links.length;i++){
    try{const x=parseDetail(await fetchText(links[i]),links[i],source);if(x)items.push(x)}catch(e){console.log(`      ⚠ ${links[i]}: ${e.message}`)}
    if((i+1)%25===0)console.log(`      ${i+1}/${links.length} hlasování…`);
  }
  return [...new Map(items.map(x=>[`${x.date}|${x.number}`,x])).values()];
}

console.log(`\nHLASOVÁNÍ ZMČ PRAHA 8 — ${BOOTSTRAP?'KOMPLETNÍ BOOTSTRAP':'INKREMENTÁLNÍ SYNC'} — v3.0.5`);
console.log('────────────────────────────────────────────────────────');
const pageHtml=await fetchText(PAGE); const sources=discoverSources(pageHtml);
if(!sources.length)throw new Error('Na stránce Prahy 8 nebyly nalezeny žádné přehledy hlasování.');
const old=await readJson(DATA,[]); const oldSources=await readJson(SOURCES,[]); const known=new Set(oldSources.map(x=>x.url));
const todo=BOOTSTRAP?sources:sources.filter(x=>!known.has(x.url));
console.log(`Zdrojová stránka: ${sources.length} zasedání Zastupitelstva · ke zpracování: ${todo.length}.`);
if(PLAN){console.log(todo.length?todo.map(x=>`  ${x.date} · ${x.url}`).join('\n'):'✅ Žádné nové zasedání.');process.exit(0)}
if(!BOOTSTRAP && !old.length)throw new Error('Chybí historický základ data/hlasovani.json. Nejdřív spusťte npm run sync:voting:bootstrap.');
if(!todo.length){console.log('✅ Žádné nové zasedání. Existující hlasování zůstala beze změny.');process.exit(0)}
let fresh=[]; const processed=[];
for(let i=0;i<todo.length;i++){
  const s=todo[i]; console.log(`   ${i+1}/${todo.length} ${s.date||s.title}`);
  try{
    const items=await crawlSource(s);
    if(!items.length)throw new Error('export neobsahuje rozpoznatelné hlasování');
    fresh.push(...items); processed.push(s); console.log(`      nalezeno ${items.length} hlasování.`);
  }catch(e){
    // Neoznačíme zasedání jako zpracované, pokud jsme z něj nezískali žádné hlasování.
    // Denní sync se k němu tak může bezpečně vrátit po opravě parseru / zdroje.
    console.log(`      ⚠ zasedání nebylo uloženo: ${e.message}`);
  }
}
if(!fresh.length)throw new Error('Z žádného zasedání se nepodařilo načíst hlasování. Existující dataset nebyl přepsán.');
const merged=BOOTSTRAP?fresh:[...old,...fresh];
const unique=[...new Map(merged.map(x=>[`${x.date}|${x.number}`,x])).values()].sort((a,b)=>(b.date||'').localeCompare(a.date||'')||a.number-b.number);
const sourceBase=BOOTSTRAP?processed:[...oldSources,...processed];
const sourceUnique=[...new Map(sourceBase.map(x=>[x.url,x])).values()].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
await atomicJson(DATA,unique); await atomicJson(SOURCES,sourceUnique);
console.log(`✅ HOTOVO: ${unique.length.toLocaleString('cs-CZ')} hlasování z ${sourceUnique.length}/${sources.length} úspěšně zpracovaných zasedání Zastupitelstva${BOOTSTRAP?' (historický základ)':''}.`);
if(sourceUnique.length!==sources.length)console.log(`⚠ ${sources.length-sourceUnique.length} zasedání zůstává ke zpracování; nebudou považována za synchronizovaná.`);
