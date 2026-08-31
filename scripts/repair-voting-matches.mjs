import {readFile,writeFile,rename} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const VOTES=resolve(root,'data','hlasovani.json');
const RESOLUTIONS=resolve(root,'data','usneseni.json');

const STOP=new Set(['k','ke','ku','v','ve','o','od','do','na','pro','se','s','z','ze','a','i','či','u','za','dle','podle','městské','části','praha','prahy','mc','mč','návrh','návrhu','záměr','záměru']);
function ascii(v=''){return String(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()}
function tokens(v=''){
  return ascii(v).replace(/hlavniho mesta prahy/g,' hmp ').replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(x=>x.length>2&&!STOP.has(x));
}
function stem(t=''){
  if(t.length<=5)return t;
  // Lehký český stem pro názvy bodů: „problematice“ × „problematika“,
  // „revitalizace“ × „revitalizaci“ apod. Nejde o jazykovou analýzu,
  // jen o bezpečnější porovnání názvů stejného jednání.
  return t.slice(0,Math.min(7,t.length));
}
function dice(a,b,stemmed=false){
  const A=new Set(tokens(a).map(x=>stemmed?stem(x):x));
  const B=new Set(tokens(b).map(x=>stemmed?stem(x):x));
  if(!A.size||!B.size)return 0;
  let hit=0;for(const x of A)if(B.has(x))hit++;
  return 2*hit/(A.size+B.size);
}
function overlapCount(a,b){
  const A=new Set(tokens(a).map(stem)),B=new Set(tokens(b).map(stem));
  let n=0;for(const x of A)if(B.has(x))n++;return n;
}
function isZmc(r){return String(r?.organ||r?.body||'').toLowerCase().includes('zastupitel')||/^Usn\s+ZMC\b/i.test(String(r?.id||''))}

const votes=JSON.parse(await readFile(VOTES,'utf8'));
const resolutions=JSON.parse(await readFile(RESOLUTIONS,'utf8'));
if(!Array.isArray(votes)||!Array.isArray(resolutions))throw new Error('Hlasování nebo usnesení nejsou pole.');

const byDate=new Map();
for(const v of votes){if(!v?.date)continue;(byDate.get(v.date)||byDate.set(v.date,[]).get(v.date)).push(v)}

let already=0,paired=0,unresolved=0;
const used=new Set();
const examples=[];

// Nejprve rezervujeme hlasování, která už se podle současné webové logiky párují bezpečně.
for(const r of resolutions.filter(isZmc)){
  const same=byDate.get(r.date)||[];
  let best=null,bestScore=0;
  for(const v of same){const s=dice(r.title,v.title,false);if(s>bestScore){bestScore=s;best=v}}
  if(best&&bestScore>=0.72){used.add(`${best.date}|${best.number}`);already++}
}

for(const r of resolutions.filter(isZmc)){
  const same=byDate.get(r.date)||[];
  let current=0;
  for(const v of same)current=Math.max(current,dice(r.title,v.title,false));
  if(current>=0.72)continue;

  const candidates=same.map(v=>({v,score:dice(r.title,v.title,true),hits:overlapCount(r.title,v.title)}))
    .filter(x=>x.hits>=2 && x.score>=0.76 && !used.has(`${x.v.date}|${x.v.number}`))
    .sort((a,b)=>b.score-a.score || b.hits-a.hits || Number(b.v.number||0)-Number(a.v.number||0));

  const best=candidates[0];
  if(!best){unresolved++;if(examples.length<20)examples.push(`NEPÁROVÁNO ${r.date} ${r.id||''} · ${r.title||''}`);continue}

  // Při stejné podobnosti je pozdější hlasování v rámci bodu zpravidla finální hlasování
  // po procedurálních návrzích / pozměňovacích hlasováních.
  const second=candidates[1];
  if(second && second.score>best.score-0.08 && second.hits>=best.hits && Number(second.v.number||0)>Number(best.v.number||0)){
    best.v=second.v;best.score=second.score;best.hits=second.hits;
  }

  const key=`${best.v.date}|${best.v.number}`;
  used.add(key);
  if(!best.v.originalTitle)best.v.originalTitle=best.v.title||'';
  best.v.title=r.title||best.v.title;
  best.v.matchedResolutionId=r.id||'';
  best.v.matchMethod='normalized-title-stem';
  best.v.matchScore=Number(best.score.toFixed(3));
  paired++;
  if(examples.length<20)examples.push(`PÁROVÁNO ${r.date} ${r.id||''} ← #${best.v.number} (${best.score.toFixed(2)}) · ${r.title||''}`);
}

const tmp=`${VOTES}.tmp`;
await writeFile(tmp,JSON.stringify(votes,null,2));
await rename(tmp,VOTES);
console.log(`✅ Párování hlasování: ${already} už bezpečně spárovaných · ${paired} nově doplněných · ${unresolved} stále bez bezpečné shody.`);
for(const x of examples)console.log('   '+x);

const kasarna=resolutions.find(r=>isZmc(r)&&/kas[aá]rna\s+karl[ií]n/i.test(String(r.title||'')));
if(kasarna){
  const matched=votes.find(v=>v.matchedResolutionId===kasarna.id)||null;
  const score=Math.max(0,...(byDate.get(kasarna.date)||[]).map(v=>dice(kasarna.title,v.title,false)));
  console.log(`Kontrola Kasárna Karlín: ${matched?`✅ hlasování #${matched.number}`:score>=0.72?'✅ páruje se přímo':'⚠ stále bez shody'}.`);
}
