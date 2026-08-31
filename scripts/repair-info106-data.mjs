import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const file=resolve(root,'data/info106.json');
const UA='Praha8Prehledy/3.0 (+public-data-indexer; public sources only)';

function decode(value=''){
  return String(value||'')
    .replace(/&nbsp;|&#160;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/&quot;/gi,'"')
    .replace(/&#39;|&apos;/gi,"'")
    .replace(/&ndash;|&#8211;/gi,'–')
    .replace(/&mdash;|&#8212;/gi,'—')
    .replace(/&gt;/gi,'>')
    .replace(/&lt;/gi,'<');
}

function clean(value=''){
  return decode(value)
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function cleanTitle(value=''){
  let text=clean(value);
  if(!text)return text;

  text=text.replace(/^\d{1,2}\.\s*\d{1,2}\.\s*20\d{2}\s*/,'');
  text=text.replace(/^Žádost\s+o\s+poskytnutí\s+informac[^\s]*\s+20\d{2}\s+(?=\d{1,2}\.\s*\d{1,2}\.\s*20\d{2})/iu,'');
  text=text.replace(/^\d{1,2}\.\s*\d{1,2}\.\s*20\d{2}\s*/,'');

  const boundaries=[
    /\s+Žádost\s+o\s+poskytnutí\s+informace\s+20\d{2}\b/i,
    /\s+\d{1,2}\.\s*\d{1,2}\.\s*20\d{2}\s+Žádost\s+o\s+/i,
    /\s+Mohlo by vás\b/i,
    /\s+Odpověď\s*:/i,
    /\s+top\s+PC verze\b/i,
    /\s+Povinné a praktické informace\b/i,
    /\s+Úřední hodiny\b/i,
    /\s+Povinně zveřejňované informace\b/i,
    /\s+1\s+2\s+3\s+4\s*(?:>|&gt;)?/i
  ];
  let end=text.length;
  for(const re of boundaries){
    const m=text.match(re);
    if(m&&m.index>0)end=Math.min(end,m.index);
  }
  text=text.slice(0,end).trim();
  return text.replace(/[\s.,;:–—-]+$/g,'').trim();
}

function isGeneric(title=''){
  return /^Žádost\s+o\s+poskytnutí\s+informace\s+20\d{2}$/i.test(clean(title));
}

function isContaminated(title=''){
  const x=String(title||'');
  return /top\s+PC verze|Povinné a praktické informace|Povinně zveřejňované|<a\s+href|&gt;|\b1\s+2\s+3\s+4\b/i.test(x);
}

async function get(url){
  const r=await fetch(url,{headers:{'user-agent':UA,'accept':'text/html,application/xhtml+xml'}});
  if(!r.ok)throw new Error(`${r.status} ${url}`);
  return r.text();
}

function extractDetailTitle(html){
  const text=clean(html);
  const answer=text.search(/\bOdpověď\s*:/i);
  if(answer<0)return '';

  // Detail může obsahovat stejný obecný nadpis i v navigaci. Bereme proto
  // poslední výskyt obecného nadpisu PŘED skutečným začátkem odpovědi.
  const before=text.slice(0,answer);
  const re=/Žádost\s+o\s+poskytnutí\s+informace\s+20\d{2}/gi;
  let m,last=null;
  while((m=re.exec(before)))last=m;
  if(!last)return '';

  let subject=before.slice(last.index+last[0].length).trim();
  subject=subject
    .replace(/^\d{1,2}\.\s*\d{1,2}\.\s*20\d{2}\s*/,'')
    .replace(/^Poskytnut[eé]\s+informace\s+20\d{2}\s*/i,'')
    .trim();
  return cleanTitle(subject);
}

async function repairFromDetails(rows){
  const targets=rows.filter(r=>isGeneric(r.title)||isContaminated(r.title));
  let cursor=0,changed=0,failed=0;
  const workers=Array.from({length:8},async()=>{
    while(true){
      const index=cursor++;
      if(index>=targets.length)return;
      const row=targets[index];
      try{
        const html=await get(String(row.url||''));
        const title=extractDetailTitle(html);
        if(title&&!isGeneric(title)){
          if(title!==row.title){row.title=title;changed++}
        }else{
          failed++;
          console.warn(`106: nepodařilo se najít předmět: ${row.url}`);
        }
      }catch(e){
        failed++;
        console.warn(`106: detail selhal ${row.url}: ${e.message}`);
      }
    }
  });
  await Promise.all(workers);
  return {targets:targets.length,changed,failed};
}

const rows=JSON.parse(await readFile(file,'utf8'));
if(!Array.isArray(rows))throw new Error('data/info106.json není pole.');

// Nejdřív bezpečně očistíme názvy, které už předmět obsahují.
let cleaned=0;
for(const row of rows){
  if(isGeneric(row.title))continue;
  const next=cleanTitle(row.title);
  if(next&&next!==row.title){row.title=next;cleaned++}
}

// Obecné nebo znečištěné položky čteme z jejich vlastního detailu. Na detailu
// je struktura stabilnější: obecný nadpis -> skutečný předmět -> „Odpověď:“.
const detail=await repairFromDetails(rows);

const bad=rows.filter(r=>isGeneric(r.title)||isContaminated(r.title));
if(bad.length){
  console.error('106: po opravě zůstávají chybné názvy:');
  for(const x of bad.slice(0,15))console.error('-',x.title,x.url);
  throw new Error(`Po opravě zůstalo ${bad.length} obecných nebo znečištěných názvů.`);
}

await writeFile(file,JSON.stringify(rows,null,2)+'\n');
console.log(`106: ${rows.length} žádostí; očištěno ${cleaned}; detailů ${detail.targets}; z detailu opraveno ${detail.changed}; selhání ${detail.failed}; chybných 0.`);
