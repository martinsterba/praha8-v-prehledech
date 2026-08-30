import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const path=resolve(root,'data/budget-2026.json');
const budget=JSON.parse(await readFile(path,'utf8'));
const income=Array.isArray(budget.income)?budget.income:[];
const expenses=Array.isArray(budget.expenses)?budget.expenses:[];
if(!budget.year || !budget.source || !income.length || !expenses.length){
  throw new Error('Rozpočtový dataset není kompletní.');
}
console.log(`Rozpočet ${budget.year}: ${income.length} skupiny příjmů, ${expenses.length} kapitol výdajů.`);
console.log(`Zdroj: ${budget.source}`);
console.log('Rozpočet se aktualizuje ručně po schválení nového rozpočtu.');
