import {readFile,writeFile,rename} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const VOTES=resolve(root,'data','hlasovani.json');
const RESOLUTIONS=resolve(root,'data','usneseni.json');

const STOP=new Set([
  'k','ke','ku','v','ve','o','od','do','na','pro','se','s','z','ze','a','i','ci','u','za','dle','podle',
  'mestske','casti','praha','prahy','mc','navrh','navrhu','zamer','zameru','pan','panu','pana','mudr','doc','ing','mgr',
  'usn','rmc','zmc','cislo','c','hlavniho','mesta'
]);
function ascii(v=''){return String(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()}
function sourceTitle(v){return String(v?.originalTitle||v?.title||'')}
function cleanTitle(v=''){
  return ascii(v)
    .replace(/\(\s*k\s+usn[\s\S]*?\)/g,' ')
    .replace(/\bk\s+usn\.?\s*(?:c\.?|cislo)?\s*usn\s*(?:rmc|zmc)?\s*\d+\/\d{4}\b/g,' ')
    .replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
}
function tokens(v=''){return cleanTitle(v).split(' ').filter(x=>x.length>2&&!STOP.has(x))}
function nearToken(a,b){
  if(a===b)return true;
  if(a.length>=6&&b.length>=6&&a.slice(0,5)===b.slice(0,5))return true;
  // české skloňování: kasárna/kasáren, problematika/problematice apod.
  if(a.length>=5&&b.length>=5&&a.slice(0,4)===b.slice(0,4)&&Math.abs(a.length-b.length)<=2)return true;
  return false;
}
function similarity(a,b){
  const A=[...new Set(tokens(a))],B=[...new Set(tokens(b))];
  if(!A.length||!B.length)return {score:0,hits:0};
  const used=new Set();let hits=0;
  for(const x of A){
    let hit=-1;
    for(let i=0;i<B.length;i++)if(!used.has(i)&&nearToken(x,B[i])){hit=i;break}
    if(hit>=0){used.add(hit);hits++}
  }
  return {score:2*hits/(A.length+B.length),hits};
}
function isZmc(r){return String(r?.organ||r?.body||'').toLowerCase().includes('zastupitel')||/^Usn\s+ZMC\b/i.test(String(r?.id||''))}
function resolutionNo(r){const m=String(r?.id||'').match(/^Usn\s+ZMC\s+(\d+)\/\d{4}/i);return m?Number(m[1]):null}
function voteKey(v){return `${v?.date||''}|${Number(v?.number||0)}`}

const votes=JSON.parse(await readFile(VOTES,'utf8'));
const resolutions=JSON.parse(await readFile(RESOLUTIONS,'utf8'));
if(!Array.isArray(votes)||!Array.isArray(resolutions))throw new Error('Hlasování nebo usnesení nejsou pole.');
const zmc=resolutions.filter(isZmc);

// Každý běh začíná od skutečného názvu bodu z hlasovacího exportu. Tím se
// starší automatické párování nemůže stát vstupem pro nové rozhodnutí.
for(const v of votes){
  if(v.originalTitle)v.title=v.originalTitle;
  delete v.originalTitle;delete v.matchedResolutionId;delete v.matchMethod;delete v.matchScore;
}

const byDate=new Map();for(const v of votes){if(v?.date)(byDate.get(v.date)||byDate.set(v.date,[]).get(v.date)).push(v)}
const resByDate=new Map();for(const r of zmc){if(r?.date)(resByDate.get(r.date)||resByDate.set(r.date,[]).get(r.date)).push(r)}
const used=new Set(),matched=new Map();
let titlePaired=0,anchoredPaired=0;

function apply(r,v,method,score){
  v.originalTitle=sourceTitle(v);
  v.title=r.title||v.title;
  v.matchedResolutionId=r.id||'';
  v.matchMethod=method;v.matchScore=Number(score.toFixed(3));
  used.add(voteKey(v));matched.set(r.id,{r,v,method,score});
}

// 1) Názvové párování. Opakovaná hlasování ke stejnému bodu (typicky po
// procedurálním návrhu) mají stejný název; pro výsledné usnesení volíme
// poslední, tedy nejvyšší číslo hlasování.
for(const [date,rs] of resByDate){
  const same=byDate.get(date)||[];
  const jobs=rs.map(r=>{
    const candidates=same.map(v=>({v,...similarity(r.title,sourceTitle(v))}))
      .filter(x=>x.hits>=2&&x.score>=0.72)
      .sort((a,b)=>b.score-a.score||Number(b.v.number||0)-Number(a.v.number||0));
    return {r,candidates,best:candidates[0]||null};
  }).filter(x=>x.best).sort((a,b)=>b.best.score-a.best.score||b.best.hits-a.best.hits);

  for(const job of jobs){
    const available=job.candidates.filter(x=>!used.has(voteKey(x.v)));
    if(!available.length)continue;
    const topScore=available[0].score;
    const sameQuality=available.filter(x=>x.score>=topScore-0.015);
    // U více stejně kvalitních hlasování ke stejnému bodu bereme finální.
    const best=sameQuality.sort((a,b)=>Number(b.v.number||0)-Number(a.v.number||0))[0];
    // Pokud je druhý kandidát skoro stejně dobrý, ale jde o jiný název bodu,
    // necháme položku raději bez shody. Duplicitní názvy jsou naopak bezpečné.
    const competitor=available.find(x=>x!==best&&Math.abs(x.score-best.score)<0.04&&cleanTitle(sourceTitle(x.v))!==cleanTitle(sourceTitle(best.v)));
    if(competitor)continue;
    apply(job.r,best.v,'title-semantic',best.score);titlePaired++;
  }
}

// 2) Jednoznačné mezery mezi dvěma již spárovanými kotvami. Použijeme je jen
// při přesné shodě počtu po sobě jdoucích usnesení a hlasování.
for(const [date,rsRaw] of resByDate){
  const rs=rsRaw.filter(r=>resolutionNo(r)!=null).sort((a,b)=>resolutionNo(a)-resolutionNo(b));
  const same=(byDate.get(date)||[]).filter(v=>Number.isFinite(Number(v.number))).sort((a,b)=>Number(a.number)-Number(b.number));
  let changed=true;
  while(changed){
    changed=false;
    const anchors=rs.map(r=>matched.get(r.id)).filter(Boolean).sort((a,b)=>resolutionNo(a.r)-resolutionNo(b.r));
    for(let i=0;i<anchors.length-1;i++){
      const L=anchors[i],R=anchors[i+1],lr=resolutionNo(L.r),rr=resolutionNo(R.r),lv=Number(L.v.number),rv=Number(R.v.number);
      const dr=rr-lr,dv=rv-lv;if(dr<=1||dr!==dv||dr>10)continue;
      const gapR=rs.filter(r=>{const n=resolutionNo(r);return n>lr&&n<rr&&!matched.has(r.id)});
      const gapV=same.filter(v=>Number(v.number)>lv&&Number(v.number)<rv&&!used.has(voteKey(v)));
      if(gapR.length!==dr-1||gapV.length!==dv-1)continue;
      const byNo=new Map(gapV.map(v=>[Number(v.number),v]));
      if(gapR.some(r=>!byNo.has(lv+(resolutionNo(r)-lr))))continue;
      for(const r of gapR){const v=byNo.get(lv+(resolutionNo(r)-lr));apply(r,v,'anchored-order',1);anchoredPaired++;changed=true}
    }
  }
}

const unresolved=zmc.filter(r=>!matched.has(r.id)).length;
const tmp=`${VOTES}.tmp`;await writeFile(tmp,JSON.stringify(votes,null,2));await rename(tmp,VOTES);
console.log(`✅ Párování hlasování: ${titlePaired} podle názvu · ${anchoredPaired} mezi kotvami · ${unresolved} bez bezpečné shody.`);

const debugDate='2026-06-17';
console.log(`--- Kontrola ${debugDate} ---`);
for(const r of (resByDate.get(debugDate)||[]).sort((a,b)=>(resolutionNo(a)||0)-(resolutionNo(b)||0))){
  const m=matched.get(r.id);console.log(`${r.id} | ${m?`#${m.v.number} ${m.method} ${m.score.toFixed(2)}`:'BEZ SHODY'} | ${r.title}`);
}
const kasarna=zmc.find(r=>/kas[aá]rna\s+karl[ií]n/i.test(String(r.title||'')));
if(kasarna){
  const m=matched.get(kasarna.id);
  console.log(`Kontrola Kasárna Karlín: ${m?`✅ ${kasarna.id} → hlasování #${m.v.number} (${m.method})`:'⚠ stále bez bezpečné shody'}.`);
  if(!m)process.exitCode=2;
}
