import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const target=process.argv[2]||'';
const readJson=async(path,fallback)=>{try{return JSON.parse(await readFile(path,'utf8'))}catch{return fallback}};
const writeJson=(path,data)=>writeFile(path,JSON.stringify(data,null,2));
const statusPath=resolve(root,'data','source-status.json');
const status=await readJson(statusPath,{});
const now=new Date().toISOString();
const loaded=(count,updated=now,extra={})=>({
  status:Number(count)>0?'data načtena':'čeká na naplnění',
  count:Number(count)||0,
  updated:updated||null,
  mode:Number(count)>0?'aktualizováno':'nenačteno',
  ...extra
});

if(target==='voting'){
  const votes=await readJson(resolve(root,'data','hlasovani.json'),[]);
  const meetings=await readJson(resolve(root,'data','hlasovani-zdroje.json'),[]);
  const count=Array.isArray(votes)?votes.length:0;
  status.voting=loaded(count,now,{meetings:Array.isArray(meetings)?meetings.length:0});
  console.log(`Stav hlasování: ${count.toLocaleString('cs-CZ')} hlasování · ${status.voting.meetings} zasedání.`);
}else if(target==='contracts'){
  const p8=await readJson(resolve(root,'data','smlouvy.json'),{});
  const entities=await readJson(resolve(root,'data','smlouvy-subjekty.json'),{});
  const p8Updated=p8?.meta?.updated||now;
  const entitiesUpdated=entities?.updated||entities?.meta?.updated||p8Updated;
  const p8Count=Number(p8?.meta?.total||p8?.contracts?.length||0);
  const entityCount=Number(entities?.meta?.totalOtherContracts||entities?.meta?.totalContracts||0) ||
    (Array.isArray(entities?.entities)?entities.entities.reduce((sum,e)=>sum+Number(e?.count||e?.contracts?.length||0),0):0);
  status.contracts=loaded(p8Count,p8Updated);
  status.contractEntities=loaded(entityCount,entitiesUpdated);
  console.log(`Stav Registru smluv: MČ ${p8Count.toLocaleString('cs-CZ')} · organizace a firmy ${entityCount.toLocaleString('cs-CZ')} · MČ ${p8Updated} · subjekty ${entitiesUpdated}.`);
}else if(target==='census'){
  const census=await readJson(resolve(root,'data','scitani2021.json'),null);
  const hasData=!!(census&&typeof census==='object'&&(census.population||census.housing||census.households||census.meta));
  const datasetCount=Array.isArray(census?.datasets)?census.datasets.length:(hasData?1:0);
  status.census2021=loaded(datasetCount,census?.meta?.updated||null,{mode:hasData?'aktualizováno':'nenačteno'});
  console.log(`Stav Sčítání 2021: ${hasData?'data načtena':'bez dat'} · aktualizace ${census?.meta?.updated||'neuvedena'}.`);
}else if(target==='elections'){
  const elections=await readJson(resolve(root,'data','volby.json'),{});
  const count=Array.isArray(elections?.years)?elections.years.length:(Array.isArray(elections)?elections.length:0);
  status.elections=loaded(count,now);
  console.log(`Stav voleb: ${count.toLocaleString('cs-CZ')} sad.`);
}else if(target==='budget'){
  const budget=await readJson(resolve(root,'data','budget-2026.json'),null);
  const hasData=!!budget;
  status.budgetOpenData=loaded(hasData?2:0,hasData?(budget?.meta?.updated||budget?.updated||now):null);
  console.log(`Stav rozpočtu: ${hasData?'data načtena':'bez dat'}.`);
}else{
  throw new Error(`Neznámý zdroj pro opravu stavu: ${target||'(neuveden)'}`);
}

await writeJson(statusPath,status);
