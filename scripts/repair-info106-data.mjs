import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const file=resolve(root,'data/info106.json');

function cleanTitle(value=''){
  let text=String(value||'').replace(/\s+/g,' ').trim();
  if(!text)return text;

  // Starý parser četl pevný kus HTML za aktuálním odkazem, takže se do názvu
  // často přilepilo datum a jedna či více následujících žádostí.
  text=text.replace(/^\d{1,2}\.\s*\d{1,2}\.\s*20\d{2}\s*/,'');

  // U části starších záznamů se do názvu propsal i obecný nadpis položky.
  // Odstraňujeme ho jen tehdy, když za ním bezprostředně následuje datum.
  text=text.replace(/^Žádost\s+o\s+poskytnutí\s+informac[^\s]*\s+20\d{2}\s+(?=\d{1,2}\.\s*\d{1,2}\.\s*20\d{2})/iu,'');
  text=text.replace(/^\d{1,2}\.\s*\d{1,2}\.\s*20\d{2}\s*/,'');

  const firstRequest=text.search(/Žádost\s+o\s+(?:poskytnutí\s+)?informac(?:i|e|í)\b/i);
  if(firstRequest>0)text=text.slice(firstRequest);

  const boundaries=[
    /\s+Žádost\s+o\s+poskytnutí\s+informace\s+20\d{2}\b/i,
    /\s+\d{1,2}\.\s*\d{1,2}\.\s*20\d{2}\s+Žádost\s+o\s+/i,
    /\s+Mohlo by vás\b/i,
    /\s+Odpověď\s*:/i
  ];
  let end=text.length;
  for(const re of boundaries){
    const m=text.match(re);
    if(m&&m.index>0)end=Math.min(end,m.index);
  }
  text=text.slice(0,end).trim();

  // V přehledu chceme jen předmět žádosti. Text za dvojtečkou patří až do detailu odpovědi.
  const colon=text.indexOf(':');
  if(colon>0)text=text.slice(0,colon);

  return text.replace(/[\s.,;:–—-]+$/g,'').trim();
}

const rows=JSON.parse(await readFile(file,'utf8'));
if(!Array.isArray(rows))throw new Error('data/info106.json není pole.');

let changed=0;
const bad=[];
for(const row of rows){
  const before=String(row.title||'');
  const after=cleanTitle(before);
  if(after&&after!==before){row.title=after;changed++}
  const current=String(row.title||'');
  const startsWithDate=/^\d{1,2}\.\s*\d{1,2}\.\s*20\d{2}/.test(current);
  const gluedNext=/Žádost\s+o\s+poskytnutí\s+informace\s+20\d{2}\s+\d{1,2}\.\s*\d{1,2}\.\s*20\d{2}\s+Žádost\s+o\s+/i.test(current);
  if(startsWithDate||gluedNext)bad.push(current);
}

if(bad.length){
  console.error('Podezřelé názvy po opravě:');
  for(const title of bad.slice(0,10))console.error('-',title);
  throw new Error(`Po opravě zůstalo ${bad.length} podezřelých slepených názvů.`);
}

await writeFile(file,JSON.stringify(rows,null,2)+'\n');
console.log(`106: zkontrolováno ${rows.length} žádostí, upraveno ${changed} názvů, podezřelých zůstává 0.`);
