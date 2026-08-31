import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const file=resolve(root,'data/info106.json');
const UA='Praha8Prehledy/3.0 (+public-data-indexer; public sources only)';
const clean=s=>String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&ndash;|&#8211;/g,'–').replace(/&mdash;|&#8212;/g,'—').replace(/&gt;/g,'>').replace(/&lt;/g,'<').replace(/\s+/g,' ').trim();
const absolute=(href,base)=>new URL(href,base).href;

function cleanTitle(value=''){
  let text=clean(value);
  if(!text)return text;
  text=text.replace(/^\d{1,2}\.\s*\d{1,2}\.\s*20\d{2}\s*/,'');
  text=text.replace(/^Žádost\s+o\s+poskytnutí\s+informac[^\s]*\s+20\d{2}\s+(?=\d{1,2}\.\s*\d{1,2}\.\s*20\d{2})/iu,'');
  text=text.replace(/^\d{1,2}\.\s*\d{1,2}\.\s*20\d{2}\s*/,'');
  const boundaries=[/\s+Žádost\s+o\s+poskytnutí\s+informace\s+20\d{2}\b/i,/\s+\d{1,2}\.\s*\d{1,2}\.\s*20\d{2}\s+Žádost\s+o\s+/i,/\s+Mohlo by vás\b/i,/\s+Odpověď\s*:/i,/\s+top\s+PC verze\b/i];
  let end=text.length;
  for(const re of boundaries){const m=text.match(re);if(m&&m.index>0)end=Math.min(end,m.index)}
  text=text.slice(0,end).trim();
  return text.replace(/[\s.,;:–—-]+$/g,'').trim();
}

async function get(url){
  const r=await fetch(url,{headers:{'user-agent':UA,'accept':'text/html,application/xhtml+xml'}});
  if(!r.ok)throw new Error(`${r.status} ${url}`);
  return r.text();
}

// Na stránkách Prahy 8 je první nadpis pouze obecné „Žádost o poskytnutí informace 2026“.
// Skutečný předmět žádosti je až text pod datem. Proto ho čteme přímo ze seznamu,
// vždy jen do začátku následující položky, a párujeme podle URL detailu.
function extractListing(html,pageUrl,year){
  const matches=[...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?Žádost\s+o\s+poskytnutí\s+informace\s+20\d{2}[\s\S]*?<\/a>/gi)];
  const found=[];
  for(let i=0;i<matches.length;i++){
    const m=matches[i];
    const url=absolute(m[1],pageUrl);
    const start=m.index+m[0].length;
    const end=i+1<matches.length?matches[i+1].index:html.length;
    let text=clean(html.slice(start,end));
    text=text.replace(/^\s*\d{1,2}\.\s*\d{1,2}\.\s*20\d{2}\s*/,'');
    text=text.replace(/\s+(?:1\s+2\s+3|Mohlo by vás|top\s+PC verze|Povinné a praktické informace).*$/i,'').trim();
    const title=cleanTitle(text);
    if(title && !/^Žádost\s+o\s+poskytnutí\s+informace\s+20\d{2}$/i.test(title))found.push({url,title});
  }
  const links=[];
  for(const m of html.matchAll(/href=["']([^"']+)["']/gi)){
    try{
      const u=absolute(m[1],pageUrl);
      if(new URL(u).hostname.endsWith('praha8.cz') && new RegExp(`Poskytnute-informace-${year}`,'i').test(u))links.push(u);
    }catch{}
  }
  return {found,links};
}

async function titlesFromListings(years){
  const map=new Map();
  for(const year of years){
    const queue=[`https://m.praha8.cz/Poskytnute-informace-${year}`];
    const seen=new Set();
    let pages=0;
    while(queue.length && pages<100){
      const url=queue.shift();
      if(seen.has(url))continue;
      seen.add(url);
      let html='';
      try{html=await get(url)}catch(e){console.warn(`106 ${year}: nelze načíst ${url}: ${e.message}`);continue}
      pages++;
      const {found,links}=extractListing(html,url,year);
      for(const x of found)map.set(x.url,x.title);
      for(const link of links)if(!seen.has(link))queue.push(link);
    }
    console.log(`106 ${year}: ${pages} stran seznamu`);
  }
  return map;
}

const rows=JSON.parse(await readFile(file,'utf8'));
if(!Array.isArray(rows))throw new Error('data/info106.json není pole.');
const years=[...new Set(rows.map(r=>Number(r.year)).filter(y=>y>=2007))].sort((a,b)=>b-a);
const listingTitles=await titlesFromListings(years);

let changed=0,fromListing=0;
const bad=[];
for(const row of rows){
  const before=String(row.title||'');
  const listed=listingTitles.get(String(row.url||''));
  const after=listed||cleanTitle(before);
  if(listed)fromListing++;
  if(after&&after!==before){row.title=after;changed++}
  const current=String(row.title||'');
  const generic=/^Žádost\s+o\s+poskytnutí\s+informace\s+20\d{2}$/i.test(current);
  const startsWithDate=/^\d{1,2}\.\s*\d{1,2}\.\s*20\d{2}/.test(current);
  const gluedNext=/Žádost\s+o\s+poskytnutí\s+informace\s+20\d{2}\s+\d{1,2}\.\s*\d{1,2}\.\s*20\d{2}\s+Žádost\s+o\s+/i.test(current);
  if(generic||startsWithDate||gluedNext)bad.push({url:row.url,title:current});
}

if(bad.length){
  console.error('Podezřelé názvy po opravě:');
  for(const x of bad.slice(0,10))console.error('-',x.title,x.url);
  throw new Error(`Po opravě zůstalo ${bad.length} obecných nebo slepených názvů.`);
}

await writeFile(file,JSON.stringify(rows,null,2)+'\n');
console.log(`106: ${rows.length} žádostí; ${fromListing} předmětů ověřeno ze seznamů; upraveno ${changed}; podezřelých 0.`);
