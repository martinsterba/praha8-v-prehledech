import {writeFile,readFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const UA='Praha8Prehledy/3.0.15 (+public-data-indexer; public sources only)';
const FEEDS=[
  ['Aktuality z městské části','https://www.praha8.cz/rss/490'],
  ['Doprava','https://www.praha8.cz/rss/73567'],
  ['Kultura a volný čas','https://www.praha8.cz/rss/97443'],
  ['Sociální oblast a zdravotnictví','https://www.praha8.cz/rss/75652'],
  ['Sport','https://www.praha8.cz/rss/494'],
  ['Školství','https://www.praha8.cz/rss/67304'],
  ['Životní prostředí','https://www.praha8.cz/rss/79261'],
  ['Informace z úřadu','https://www.praha8.cz/rss/67326']
];

// RSS na Praze 8 někdy neobsahuje všechny položky, které jsou už zveřejněné
// v oficiálním přehledu. Proto nejdůležitější přehledy čteme souběžně s RSS.
const LISTINGS=[
  ['Aktuality z městské části','https://www.praha8.cz/are_490?size=1'],
  ['Doprava','https://www.praha8.cz/Aktuality-z-dopravy.html?size=1'],
  ['Školství','https://www.praha8.cz/Aktualni-informace-z-oblasti-skolstvi.html?size=1']
];

const clean=s=>String(s||'')
  .replace(/<!\[CDATA\[|\]\]>/g,'')
  .replace(/<script[\s\S]*?<\/script>/gi,' ')
  .replace(/<style[\s\S]*?<\/style>/gi,' ')
  .replace(/<[^>]+>/g,' ')
  .replace(/&nbsp;|&#160;/g,' ')
  .replace(/&amp;/g,'&')
  .replace(/&quot;/g,'"')
  .replace(/&#39;|&apos;/g,"'")
  .replace(/&ndash;|&#8211;/g,'–')
  .replace(/&mdash;|&#8212;/g,'—')
  .replace(/\s+/g,' ').trim();
const tag=(xml,n)=>{const m=xml.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${n}>`,'i'));return m?clean(m[1]):''};
const parseDate=s=>{const d=new Date(s);return Number.isNaN(d.valueOf())?'':d.toISOString().slice(0,10)};
const isoCz=s=>{const m=String(s||'').match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(20\d{2})/);return m?`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:''};
const absolute=(href,base)=>{try{return new URL(href,base).href}catch{return ''}};
const canonicalUrl=url=>{try{const u=new URL(url);u.protocol='https:';u.hostname=u.hostname.replace(/^m\./i,'www.');u.hash='';u.search='';return u.href.replace(/\/$/,'')}catch{return String(url||'')}};
const fetchText=async url=>{const r=await fetch(url,{headers:{'user-agent':UA,'accept':'text/html,application/rss+xml,application/xml,*/*'}});if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.text()};

function parseListing(html,base,channel){
  const items=[];
  // Na přehledech Prahy 8 je datum u položky krátce za odkazem na detail.
  // Bereme jen odkazy na detailní HTML stránky a vyžadujeme datum v okolním bloku,
  // čímž odfiltrujeme navigaci, stránkování i menu.
  for(const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
    const title=clean(m[2]);
    if(title.length<8 || title.length>220 || /^(další|předchozí|úvodní|občan|kontakty?|více|detail)$/i.test(title))continue;
    const url=absolute(m[1],base);
    if(!url || !/praha8\.cz/i.test(url) || !/\.html(?:[?#]|$)/i.test(url))continue;
    if(canonicalUrl(url)===canonicalUrl(base))continue;
    const tail=html.slice(m.index+m[0].length,Math.min(html.length,m.index+m[0].length+1800));
    const dm=clean(tail).match(/\b(\d{1,2}\.\s*\d{1,2}\.\s*20\d{2})\b/);
    if(!dm)continue;
    const date=isoCz(dm[1]);
    if(!date)continue;
    const textAfterDate=clean(tail.slice(Math.max(0,tail.search(/\d{1,2}\.\s*\d{1,2}\.\s*20\d{2}/))));
    const description=textAfterDate.replace(/^\d{1,2}\.\s*\d{1,2}\.\s*20\d{2}\s*/,'').slice(0,650).trim();
    items.push({title,url:canonicalUrl(url),date,description,channel});
  }
  return [...new Map(items.map(x=>[x.url,x])).values()];
}

const all=[],failures=[];
for(const [channel,url] of FEEDS){
  try{
    const xml=await fetchText(url);
    const items=[...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)]
      .map(m=>m[1])
      .map(x=>({title:tag(x,'title'),url:canonicalUrl(tag(x,'link')),date:parseDate(tag(x,'pubDate')||tag(x,'date')),description:tag(x,'description'),channel}))
      .filter(x=>x.title&&x.url);
    all.push(...items);
    console.log(`   RSS · ${channel}: ${items.length}`);
  }catch(e){failures.push(`RSS ${channel}`);console.log(`   ⚠️ RSS · ${channel}: ${String(e.message||e)}`)}
}
for(const [channel,url] of LISTINGS){
  try{
    const html=await fetchText(url);
    const items=parseListing(html,url,channel);
    all.push(...items);
    console.log(`   Přehled · ${channel}: ${items.length}`);
  }catch(e){failures.push(`Přehled ${channel}`);console.log(`   ⚠️ Přehled · ${channel}: ${String(e.message||e)}`)}
}

const cutoff=new Date();
cutoff.setHours(0,0,0,0);
cutoff.setDate(cutoff.getDate()-6);
const cutoffDate=cutoff.toISOString().slice(0,10);

// Stejný článek může být v hlavním přehledu i tematické rubrice. Preferujeme
// bohatší popis, ale jeden článek zobrazíme pouze jednou.
const byUrl=new Map();
for(const x of all){
  if(!x.date||x.date<cutoffDate)continue;
  const key=canonicalUrl(x.url);
  const prev=byUrl.get(key);
  if(!prev || String(x.description||'').length>String(prev.description||'').length)byUrl.set(key,{...x,url:key});
}
const items=[...byUrl.values()].sort((a,b)=>(b.date||'').localeCompare(a.date||'')||(b.title||'').localeCompare(a.title||'','cs'));

await mkdir(resolve(root,'data'),{recursive:true});
await writeFile(resolve(root,'data/novinky.json'),JSON.stringify(items,null,2));
let st={};try{st=JSON.parse(await readFile(resolve(root,'data/source-status.json'),'utf8'))}catch{}
st.news={status:items.length?'data načtena':'čeká na naplnění',count:items.length,updated:new Date().toISOString(),mode:items.length?'aktualizováno':'nenačteno',feeds:FEEDS.length,listingPages:LISTINGS.length,failedSources:failures.length};
await writeFile(resolve(root,'data/source-status.json'),JSON.stringify(st,null,2));
console.log(`✅ Novinky: načteno ${items.length} unikátních položek za posledních 7 dní z RSS + oficiálních přehledů${failures.length?` · ${failures.length} zdrojů selhalo`:''}.`);
