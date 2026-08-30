import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
async function readJson(p){try{return JSON.parse(await readFile(p,'utf8'))}catch{return null}}
async function candidates(file,validator){const out=[];const parent=resolve(root,'..');for(const d of await readdir(parent,{withFileTypes:true})){if(!d.isDirectory()||!/^praha8-prehledy-v\d/i.test(d.name)||resolve(parent,d.name)===root)continue;const p=resolve(parent,d.name,'data',file);if(!existsSync(p))continue;const x=await readJson(p);if(validator(x))out.push({dir:d.name,path:p,data:x})}out.sort((a,b)=>(b.data.updated||b.data.meta?.updated||'').localeCompare(a.data.updated||a.data.meta?.updated||'')||b.dir.localeCompare(a.dir,undefined,{numeric:true}));return out}
await mkdir(resolve(root,'data'),{recursive:true});
const entity=(await candidates('smlouvy-subjekty.json',x=>Array.isArray(x?.entities)&&x.entities.length===40&&Number(x?.meta?.totalContracts)>0))[0];
const p8=(await candidates('smlouvy.json',x=>x?.meta?.historyComplete===true&&Array.isArray(x?.contracts)&&x.contracts.length>0))[0];
const registry=(await candidates('contract-entities.json',x=>x?.qa?.status==='verified'&&x?.entities?.length===40))[0];
let copied=0;
for(const [name,c] of [['smlouvy-subjekty.json',entity],['smlouvy.json',p8],['contract-entities.json',registry]]){if(c){await writeFile(resolve(root,'data',name),JSON.stringify(c.data,null,2));console.log(`✓ ${name}: převzato z ${c.dir}`);copied++}else console.log(`– ${name}: vhodný ověřený dataset v předchozích verzích nenalezen`)}
if(!entity){console.error('\nChybí historický dataset organizací. Pokud je v2.6.4 ve stejné složce Downloads a obsahuje data/smlouvy-subjekty.json, spusťte příkaz znovu. Jinak je nutné jednou spustit npm run sync:contracts:entities.');process.exitCode=2}else{console.log(`\n✅ Data organizací z Registru smluv jsou připravena bez nového stahování 24,7 GB. Převzato ${copied} datových souborů.`)}
