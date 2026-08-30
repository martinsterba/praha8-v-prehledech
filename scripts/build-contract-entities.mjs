import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const TARGET_MUNICIPALITY={name:'Městská část Praha 8',ico:'00063797',kind:'municipality',type:'městská část'};
const IPODEC_ICO='40764877';
const IPODEC_RE=/\bIPODEC\b/i;
const COMPANY_NAMES=new Set([
  'Osmá servisní a.s.',
  'Osmá správa majetku a služeb a.s.',
  'Správa tepelného hospodářství MČ Praha 8 s.r.o.'
]);
const KNOWN_ICO_BY_NAME=new Map([
  ['Servisní středisko pro správu svěřeného majetku MČ Praha 8','00639524'],
  ['Sociální a ošetřovatelské služby Praha 8','70871213']
]);
const normIco=s=>{const d=String(s||'').replace(/\D/g,'');return d?d.padStart(8,'0'):''};
const entityIco=x=>normIco(x?.ico)||KNOWN_ICO_BY_NAME.get(String(x?.name||'').trim())||'';

async function readJson(path){try{return JSON.parse(await readFile(path,'utf8'))}catch{return null}}
function score(arr){
  if(!Array.isArray(arr))return -1;
  return arr.filter(x=>/^\d{8}$/.test(normIco(x?.ico))).length*1000+arr.length;
}

async function richestOrganizations(){
  const candidates=[];
  const current=await readJson(resolve(root,'data','organizace.json'));
  if(Array.isArray(current))candidates.push({name:'aktuální verze',path:resolve(root,'data','organizace.json'),arr:current});
  try{
    const parent=resolve(root,'..');
    for(const d of await readdir(parent,{withFileTypes:true})){
      if(!d.isDirectory()||!/^praha8-prehledy-v\d/i.test(d.name)||resolve(parent,d.name)===root)continue;
      const path=resolve(parent,d.name,'data','organizace.json');
      if(!existsSync(path))continue;
      const arr=await readJson(path); if(Array.isArray(arr))candidates.push({name:d.name,path,arr});
    }
  }catch{}
  candidates.sort((a,b)=>score(b.arr)-score(a.arr));
  return candidates[0]||null;
}

export async function buildContractEntities({copyBest=true}={}){
  const best=await richestOrganizations();
  if(!best)throw new Error('Nenalezl jsem data/organizace.json. Nejprve spusť npm run sync:organizations.');
  if(copyBest && best.path!==resolve(root,'data','organizace.json')){
    await writeFile(resolve(root,'data','organizace.json'),JSON.stringify(best.arr,null,2));
    console.log(`Přebírám nejúplnější dataset organizací z ${best.name}.`);
  }
  const all=best.arr;
  const ipo=all.filter(x=>normIco(x.ico)===IPODEC_ICO||IPODEC_RE.test(x.name||''));
  const eligible=all.filter(x=>!(normIco(x.ico)===IPODEC_ICO||IPODEC_RE.test(x.name||'')));
  const entities=eligible.map(x=>{
    const company=COMPANY_NAMES.has(x.name)||x.type==='městská obchodní společnost'||(x.legalType==='obchodní společnost'&&String(x.ownershipShare||'').trim()==='100 %');
    return {
      name:x.name,
      ico:entityIco(x),
      kind:company?'company':'organization',
      type:x.type||x.legalType||'',
      legalType:x.legalType||'',
      ownershipShare:company?(x.ownershipShare||'100 %'):'',
      source:x.url||'',
      website:x.website||''
    };
  }).sort((a,b)=>a.kind.localeCompare(b.kind)||a.name.localeCompare(b.name,'cs'));
  const companies=entities.filter(x=>x.kind==='company');
  const organizations=entities.filter(x=>x.kind==='organization');
  const missingIco=entities.filter(x=>!x.ico||x.ico==='00000000');
  const duplicateIco=[...new Map(entities.filter(x=>x.ico&&x.ico!=='00000000').map(x=>[x.ico,[]])).keys()].filter(ico=>entities.filter(x=>x.ico===ico).length>1);
  const checks={
    expectedEligible:40,
    actualEligible:entities.length,
    expectedOrganizations:37,
    actualOrganizations:organizations.length,
    expectedCompanies:3,
    actualCompanies:companies.length,
    excludedIpodec:ipo.length,
    missingIco:missingIco.length,
    duplicateIco:duplicateIco.length
  };
  const ok=checks.actualEligible===40&&checks.actualOrganizations===37&&checks.actualCompanies===3&&checks.excludedIpodec>=1&&checks.missingIco===0&&checks.duplicateIco===0;
  const payload={
    schema:1,
    updated:new Date().toISOString(),
    scope:{municipality:TARGET_MUNICIPALITY,eligibleEntities:40,excluded:['IPODEC - ČISTÉ MĚSTO a.s. (MČ Praha 8 nemá většinovou kontrolu)']},
    municipality:TARGET_MUNICIPALITY,
    entities,
    groups:{organizations,companies},
    qa:{status:ok?'verified':'failed',checks,sourceDataset:best.name}
  };
  await writeFile(resolve(root,'data','contract-entities.json'),JSON.stringify(payload,null,2));
  console.log('\nREGISTR SMLUV — ENTITY REGISTRY');
  console.log('─────────────────────────────────────────────');
  console.log(`MČ Praha 8:                  1 · IČO ${TARGET_MUNICIPALITY.ico}`);
  console.log(`Příspěvkové organizace:     ${organizations.length} / 37`);
  console.log(`100% městské firmy:         ${companies.length} / 3`);
  console.log(`Celkem dalších subjektů:    ${entities.length} / 40`);
  console.log(`IPODEC vyřazen:              ${ipo.length?`ano (${ipo.map(x=>x.name).join(', ')})`:'NE'}`);
  console.log(`Chybějící IČO:              ${missingIco.length}`);
  console.log(`Duplicitní IČO:             ${duplicateIco.length}`);
  console.log('─────────────────────────────────────────────');
  for(const x of companies)console.log(`FIRMA  ${x.ico||'BEZ IČO'}  ${x.name}`);
  console.log('─────────────────────────────────────────────');
  if(missingIco.length){console.log('CHYBÍ IČO:');for(const x of missingIco)console.log(`  - ${x.name}`)}
  if(duplicateIco.length){console.log('DUPLICITNÍ IČO:');for(const ico of duplicateIco)console.log(`  - ${ico}: ${entities.filter(x=>x.ico===ico).map(x=>x.name).join(' | ')}`)}
  console.log(ok?'✅ Entity registry je připravený pro Registr smluv.':'❌ Entity registry zatím není bezpečné použít pro hromadný import smluv.');
  return {ok,payload};
}

if(import.meta.url===`file://${process.argv[1]}`){
  const {ok}=await buildContractEntities();
  if(!ok)process.exitCode=2;
}
