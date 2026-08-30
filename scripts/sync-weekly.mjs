import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const syncScript=resolve(root,'scripts','sync-praha8.mjs');
const peoplePath=resolve(root,'data','lide.json');
const statusPath=resolve(root,'data','source-status.json');

const personKey=(name='')=>{
  const drop=new Set(['mgr','bc','ing','phdr','judr','rndr','mvdr','doc','prof','phd','mba','mpa','ma','dis','csc','dba','bca','et']);
  const toks=String(name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(Boolean).filter(x=>!drop.has(x)&&x.length>1);
  return toks.slice(0,2).sort().join(' ');
};
const readJson=async(path,fallback)=>{try{return JSON.parse(await readFile(path,'utf8'))}catch{return fallback}};
const run=args=>new Promise((ok,fail)=>{
  const child=spawn(process.execPath,[syncScript,...args],{cwd:root,stdio:'inherit',env:process.env});
  child.on('error',fail);
  child.on('exit',code=>code===0?ok():fail(new Error(`Synchronizace skončila s kódem ${code}.`)));
});

console.log('\nTÝDENNÍ SYNCHRONIZACE — zachování rolí mezi datovými sadami HMP');
console.log('────────────────────────────────────────────────────────────');

// První běh načte zastupitelstvo Prahy 8, HMP funkce, Parlament a organizace.
await run(['--people','--bodies','--hmp-functions','--national-roles','--organizations','--fast']);
const afterFunctions=await readJson(peoplePath,[]);
const preserved=new Map(afterFunctions.map(p=>[personKey(p.name),{
  magistrateRoles:p.magistrateRoles||[],
  otherRoles:p.otherRoles||[]
}]));
const hmpFunctionPeople=afterFunctions.filter(p=>(p.magistrateRoles||[]).length).length;
if(!hmpFunctionPeople)throw new Error('HMP funkce se nenačetly ani u jednoho člověka; týdenní dataset nepřepisuji jako úspěšný.');

// Druhý běh načte firmy HMP. Původní synchronizátor při tomto samostatném kroku
// vytváří nový lide.json, proto po něm vrátíme funkce z předchozího úspěšného kroku.
await run(['--hmp-companies','--fast']);
let people=await readJson(peoplePath,[]);
people=people.map(p=>{
  const keep=preserved.get(personKey(p.name))||{};
  return {...p,magistrateRoles:keep.magistrateRoles||[],otherRoles:keep.otherRoles||[]};
});
await writeFile(peoplePath,JSON.stringify(people,null,2));

// Stav zdrojů odvozujeme z finálního skutečně uloženého lide.json.
const status=await readJson(statusPath,{});
const now=new Date().toISOString();
const functionCount=people.filter(p=>(p.magistrateRoles||[]).length).length;
const companyCount=people.filter(p=>(p.hmpCompanyRoles||[]).length).length;
status.hmpFunctions={status:functionCount?'data načtena':'čeká na naplnění',count:functionCount,updated:now,mode:functionCount?'aktualizováno':'nenačteno'};
status.hmpCompanies={status:companyCount?'data načtena':'čeká na naplnění',count:companyCount,updated:now,mode:companyCount?'aktualizováno':'nenačteno'};
await writeFile(statusPath,JSON.stringify(status,null,2));
console.log(`\n✅ Finální lide.json: funkce HMP u ${functionCount} lidí · firmy HMP u ${companyCount} lidí.`);
