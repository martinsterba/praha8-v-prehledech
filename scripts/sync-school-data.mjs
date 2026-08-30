import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const orgFile=resolve(root,'data/organizace.json');
const snapshotFile=resolve(root,'data/school-stats-snapshot.json');
const UA='Praha8Prehledy/2.9 (+public-data-indexer; public sources only)';

const key=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const has=(name,needle)=>key(name).includes(key(needle));

const orgs=JSON.parse(await readFile(orgFile,'utf8'));
const snap=JSON.parse(await readFile(snapshotFile,'utf8'));

// Ověříme, že oficiální zdrojové dokumenty jsou stále dostupné. Samotný snapshot
// je z nich vytěžený a je součástí repozitáře, takže lokální vývoj není závislý
// na tom, jestli PDF zrovna odpovídá. Při nedostupnosti zdroje nic nehádáme.
for(const [label,url] of Object.entries(snap.sources||{})){
  try{
    const r=await fetch(url,{method:'HEAD',headers:{'user-agent':UA},redirect:'follow'});
    console.log(`   Školská data ${label}: ${r.ok?'zdroj dostupný ✓':`HTTP ${r.status}`}`);
  }catch(e){console.log(`   ⚠️ Školská data ${label}: zdroj se nepodařilo ověřit (${String(e.message||e).slice(0,100)}). Používám ověřený snapshot k ${snap.asOf}.`)}
}

let primaryMatched=0,preschoolMatched=0,capacityMatched=0;
for(const o of orgs){
  // Vyčistíme jen odvozené školské metriky; kontaktní data z ostrého syncu zachováme.
  delete o.pupils; delete o.classes; delete o.children; delete o.preschoolChildren; delete o.preschoolClasses;
  delete o.statsAsOf; delete o.statsSchoolYear; delete o.statsSource;
  const p=(snap.primary||[]).find(x=>has(o.name,x.match));
  if(p){o.pupils=p.pupils;o.classes=p.classes;primaryMatched++;}
  const m=(snap.preschool||[]).find(x=>has(o.name,x.match));
  if(m){
    if(o.type==='mateřská škola'){o.children=m.preschoolChildren;o.classes=m.preschoolClasses;}
    else {o.preschoolChildren=m.preschoolChildren;o.preschoolClasses=m.preschoolClasses;}
    preschoolMatched++;
  }
  if(o.capacity)capacityMatched++;
  if(p||m){o.statsAsOf=snap.asOf;o.statsSchoolYear=snap.schoolYear;o.statsSource='MČ Praha 8 – školské statistiky k 30. 9. 2025';}
}

await writeFile(orgFile,JSON.stringify(orgs,null,2));
console.log(`   Školská statistika: ${primaryMatched} ZŠ · ${preschoolMatched} MŠ programů · kapacita z detailu školy u ${capacityMatched} subjektů.`);
console.log(`   Aktualita: školní rok ${snap.schoolYear}, stav k ${snap.asOf.split('-').reverse().join('.')}.`);
console.log('   Pozn.: naplněnost počítáme pouze tam, kde se podařilo z oficiálního detailu školy bezpečně načíst kapacitu.');
