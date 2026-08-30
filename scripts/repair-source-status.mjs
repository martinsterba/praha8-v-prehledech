import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const target=process.argv[2]||'';
const readJson=async(path,fallback)=>{try{return JSON.parse(await readFile(path,'utf8'))}catch{return fallback}};
const writeJson=(path,data)=>writeFile(path,JSON.stringify(data,null,2));
const statusPath=resolve(root,'data','source-status.json');
const status=await readJson(statusPath,{});
const now=new Date().toISOString();

if(target==='voting'){
  const votes=await readJson(resolve(root,'data','hlasovani.json'),[]);
  const meetings=await readJson(resolve(root,'data','hlasovani-zdroje.json'),[]);
  const count=Array.isArray(votes)?votes.length:0;
  status.voting={
    status:count>0?'data načtena':'čeká na naplnění',
    count,
    updated:now,
    mode:count>0?'aktualizováno':'nenačteno',
    meetings:Array.isArray(meetings)?meetings.length:0
  };
  await writeJson(statusPath,status);
  console.log(`Stav hlasování: ${count.toLocaleString('cs-CZ')} hlasování · ${status.voting.meetings} zasedání.`);
}else{
  throw new Error(`Neznámý zdroj pro opravu stavu: ${target||'(neuveden)'}`);
}
