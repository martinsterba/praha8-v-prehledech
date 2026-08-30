import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContractEntities } from './build-contract-entities.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');

console.log('\nREGISTR SMLUV — PŘÍPRAVA ENTITY REGISTRY');
console.log('─────────────────────────────────────────────');
console.log('Nejdřív načítám kompletní zdroj „Organizace a firmy Prahy 8“.');
console.log('Teprve potom sestavím a zkontroluji entity registry pro Registr smluv.\n');

const r=spawnSync(process.execPath,['scripts/sync-praha8.mjs','--organizations','--fast'],{cwd:root,stdio:'inherit'});
if(r.status!==0)process.exit(r.status||1);

const result=await buildContractEntities({copyBest:false});
if(!result.ok)process.exit(2);
