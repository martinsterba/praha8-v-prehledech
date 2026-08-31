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
function stem(t=''){if(t.length<=5)return t;return t.slice(0,Math.min(7,t.length))}
function dice(a,b,stemmed=false){
  const A=new Set(tokens(a).map(x=>stemmed?stem(x):x));
  const B=new Set(tokens(b).map(x=>stemmed?stem(x):x));
  if(!A.size||!B.size)return 0;
  let hit=0;for(const x of A)if(B.has(x))hit++;
  return 2*hit/(A.size+B.size);
}
function overlapCount(a,b){const A=new Set(tokens(a).map(stem)),B=new Set(tokens(b).map(stem));let n=0;for(const x of A)if(B.has(x))n++;return n}
function isZmc(r){return String(r?.organ||r?.body||'').toLowerCase().includes('zastupitel')||/^Usn\s+ZMC\b/i.test(String(r?.id||''))}
function resolutionNo(r){const m=String(r?.id||'').match(/^Usn\s+ZMC\s+(\d+)\/\d{4}/i);return m?Number(m[1]):null}
function voteKey(v){return `${v?.date||''}|${Number(v?.number||0)}`}

const votes=JSON.parse(await readFile(VOTES,'utf8'));
const resolutions=JSON.parse(await readFile(RESOLUTIONS,'utf8'));
if(!Array.isArray(votes)||!Array.isArray(resolutions))throw new Error('Hlasování nebo usnesení nejsou pole.');
const zmc=resolutions.filter(isZmc);

const byDate=new Map();
for(const v of votes){if(!v?.date)continue;(byDate.get(v.date)||byDate.set(v.date,[]).get(v.date)).push(v)}
const resByDate=new Map();
for(const r of zmc){if(!r?.date)continue;(resByDate.get(r.date)||resByDate.set(r.date,[]).get(r.date)).push(r)}

let already=0,fuzzyPaired=0,anchoredPaired=0;
const used=new Set();
const matchedByResolution=new Map();
const examples=[];

function remember(r,v,method,score){used.add(voteKey(v));matchedByResolution.set(r.id,{r,v,method,score})}
function applyMatch(r,v,method,score){
  if(!v.originalTitle)v.originalTitle=v.title||'';
  v.title=r.title||v.title;
  v.matchedResolutionId=r.id||'';
  v.matchMethod=method;
  v.matchScore=Number(Number(score||1).toFixed(3));
  remember(r,v,method,score);
}

for(const [date,rs] of resByDate){
  const same=byDate.get(date)||[];
  const proposals=[];
  for(const r of rs){
    const ranked=same.map(v=>({v,score:dice(r.title,v.title,false)})).sort((a,b)=>b.score-a.score||Number(b.v.number||0)-Number(a.v.number||0));
    if(ranked[0]?.score>=0.72)proposals.push({r,v:ranked[0].v,score:ranked[0].score,second:ranked[1]?.score||0});
  }
  const counts=new Map();for(const p of proposals)counts.set(voteKey(p.v),(counts.get(voteKey(p.v))||0)+1);
  for(const p of proposals){if((counts.get(voteKey(p.v))||0)!==1)continue;remember(p.r,p.v,'direct-title',p.score);already++}
}

for(const r of zmc){
  if(matchedByResolution.has(r.id))continue;
  const same=byDate.get(r.date)||[];
  const candidates=same.map(v=>({v,score:dice(r.title,v.title,true),hits:overlapCount(r.title,v.title)}))
    .filter(x=>x.hits>=2&&x.score>=0.76&&!used.has(voteKey(x.v)))
    .sort((a,b)=>b.score-a.score||b.hits-a.hits||Number(b.v.number||0)-Number(a.v.number||0));
  const best=candidates[0];if(!best)continue;
  const second=candidates[1];
  if(second&&second.score>best.score-0.08&&second.hits>=best.hits&&Number(second.v.number||0)>Number(best.v.number||0)){best.v=second.v;best.score=second.score;best.hits=second.hits}
  applyMatch(r,best.v,'normalized-title-stem',best.score);fuzzyPaired++;
  if(examples.length<20)examples.push(`FUZZY ${r.date} ${r.id||''} ← #${best.v.number} (${best.score.toFixed(2)}) · ${r.title||''}`);
}

for(const [date,rsRaw] of resByDate){
  const rs=rsRaw.filter(r=>resolutionNo(r)!=null).sort((a,b)=>resolutionNo(a)-resolutionNo(b));
  const same=(byDate.get(date)||[]).filter(v=>Number.isFinite(Number(v.number))).sort((a,b)=>Number(a.number)-Number(b.number));
  let changed=true;
  while(changed){
    changed=false;
    const anchors=rs.map(r=>matchedByResolution.get(r.id)).filter(Boolean).filter(x=>resolutionNo(x.r)!=null&&Number.isFinite(Number(x.v.number))).sort((a,b)=>resolutionNo(a.r)-resolutionNo(b.r));
    for(let i=0;i<anchors.length-1;i++){
      const left=anchors[i],right=anchors[i+1];
      const lr=resolutionNo(left.r),rr=resolutionNo(right.r),lv=Number(left.v.number),rv=Number(right.v.number);
      const deltaR=rr-lr,deltaV=rv-lv;
      if(deltaR<=1||deltaR!==deltaV||deltaR>12)continue;
      const betweenR=rs.filter(r=>{const n=resolutionNo(r);return n>lr&&n<rr&&!matchedByResolution.has(r.id)});
      const betweenV=same.filter(v=>Number(v.number)>lv&&Number(v.number)<rv&&!used.has(voteKey(v)));
      if(betweenR.length!==deltaR-1||betweenV.length!==deltaV-1)continue;
      const byNo=new Map(betweenV.map(v=>[Number(v.number),v]));
      if(betweenR.some(r=>!byNo.has(lv+(resolutionNo(r)-lr))))continue;
      for(const r of betweenR){
        const target=byNo.get(lv+(resolutionNo(r)-lr));applyMatch(r,target,'anchored-order',1);anchoredPaired++;changed=true;
        if(examples.length<30)examples.push(`KOTVY ${date} ${r.id||''} ← #${target.number} · ${r.title||''}`);
      }
    }
  }
}

const unresolved=zmc.filter(r=>!matchedByResolution.has(r.id)).length;
const tmp=`${VOTES}.tmp`;await writeFile(tmp,JSON.stringify(votes,null,2));await rename(tmp,VOTES);
console.log(`✅ Párování hlasování: ${already} bezpečných přímých kotev · ${fuzzyPaired} fuzzy doplněných · ${anchoredPaired} doplněných mezi kotvami · ${unresolved} stále bez bezpečné shody.`);
for(const x of examples)console.log('   '+x);

const debugDate='2026-06-17';
console.log(`--- Diagnostika ${debugDate}: usnesení ---`);
for(const r of (resByDate.get(debugDate)||[]).sort((a,b)=>(resolutionNo(a)||0)-(resolutionNo(b)||0))){
  const m=matchedByResolution.get(r.id);console.log(`${r.id} | ${r.title} | ${m?`→ hlasování #${m.v.number} [${m.method}]`:'BEZ SHODY'}`);
}
console.log(`--- Diagnostika ${debugDate}: hlasování ---`);
for(const v of (byDate.get(debugDate)||[]).sort((a,b)=>Number(a.number||0)-Number(b.number||0))){
  console.log(`#${v.number} | ${v.originalTitle||v.title||''} | matched=${v.matchedResolutionId||'-'} | current=${v.title||''}`);
}

const kasarna=zmc.find(r=>/kas[aá]rna\s+karl[ií]n/i.test(String(r.title||'')));
if(kasarna){const matched=matchedByResolution.get(kasarna.id)||null;console.log(`Kontrola Kasárna Karlín: ${matched?`✅ ${kasarna.id} → hlasování #${matched.v.number} (${matched.method})`:'⚠ stále bez bezpečné shody'}.`);if(!matched)process.exitCode=2}
