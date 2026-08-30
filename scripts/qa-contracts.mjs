import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const file=resolve(root,'data','smlouvy.json');
const data=JSON.parse(await readFile(file,'utf8'));
const items=Array.isArray(data.contracts)?data.contracts:[];
const cz=n=>Number(n||0).toLocaleString('cs-CZ');
const money=n=>`${Math.round(Number(n||0)).toLocaleString('cs-CZ')} Kč`;
const byMonth={};
for(const c of items){const m=(c.signed||'nezjištěno').slice(0,7);byMonth[m]=(byMonth[m]||0)+1}
const dup=(field)=>{const m=new Map();for(const c of items){const k=String(c[field]||'').trim();if(!k)continue;const a=m.get(k)||[];a.push(c);m.set(k,a)}return [...m.entries()].filter(([,a])=>a.length>1)};
const duplicateVersionIds=dup('id');
const repeatedContractIds=dup('idContract');
const withValue=items.filter(c=>Number.isFinite(Number(c.valueCzk))&&Number(c.valueCzk)>0);
const withoutValue=items.filter(c=>!Number.isFinite(Number(c.valueCzk))||Number(c.valueCzk)<=0);
const missing={signed:items.filter(c=>!c.signed).length,subject:items.filter(c=>!c.subject||c.subject==='Smlouva').length,counterparty:items.filter(c=>!(c.counterparties||[]).length).length,url:items.filter(c=>!c.url).length,publisherIco:items.filter(c=>!c.publisherIco).length};
const icoBad=items.filter(c=>String(c.publisherIco||'').replace(/\D/g,'').padStart(8,'0')!=='00063797');
const largest=[...withValue].sort((a,b)=>b.valueCzk-a.valueCzk).slice(0,5);
const chronological=[...items].sort((a,b)=>(a.signed||'').localeCompare(b.signed||'')||(a.id||'').localeCompare(b.id||''));
const sample=[];const seen=new Set();
for(const c of [...largest,...chronological.slice(0,3),...chronological.slice(-3)]){if(c&&!seen.has(c.id)){seen.add(c.id);sample.push(c)}if(sample.length>=10)break}
const report={generatedAt:new Date().toISOString(),scope:data.meta?.dateLabel||'',total:items.length,referencePublicSearchCount:data.meta?.validation?.referencePublicSearchCount??null,validationStatus:data.meta?.validation?.status||'unknown',bySignedMonth:byMonth,uniqueVersionIds:new Set(items.map(c=>c.id).filter(Boolean)).size,duplicateVersionIds:duplicateVersionIds.map(([id,a])=>({id,count:a.length})),repeatedContractIds:repeatedContractIds.map(([id,a])=>({id,count:a.length,versionIds:a.map(x=>x.id)})),withKnownValue:withValue.length,withoutKnownValue:withoutValue.length,knownValueCzk:withValue.reduce((s,c)=>s+Number(c.valueCzk),0),uniqueCounterparties:data.meta?.partners??data.partners?.length??null,missingFields:missing,wrongPublisherIco:icoBad.length,sample:sample.map(c=>({id:c.id,idContract:c.idContract,signed:c.signed,published:c.published,subject:c.subject,counterparty:c.counterparty,valueCzk:c.valueCzk,url:c.url}))};
await writeFile(resolve(root,'data','contracts-qa.json'),JSON.stringify(report,null,2));
console.log('\nQA Registru smluv — '+(report.scope||'aktuální dataset'));
console.log('─'.repeat(62));
console.log(`Celkem:                 ${cz(report.total)} smluv`);
for(const [m,n] of Object.entries(byMonth).sort())console.log(`  datum uzavření ${m}:     ${cz(n)}`);
if(report.referencePublicSearchCount!=null)console.log(`Veřejné vyhledávání:    ${cz(report.referencePublicSearchCount)} · rozdíl ${report.total-report.referencePublicSearchCount>=0?'+':''}${report.total-report.referencePublicSearchCount}`);
console.log(`Unikátní idVerze:       ${cz(report.uniqueVersionIds)} · duplicity ${duplicateVersionIds.length}`);
console.log(`Opakované idSmlouvy:    ${cz(repeatedContractIds.length)} (diagnostika verzí/dodatků)`);
console.log(`S uvedenou hodnotou:    ${cz(report.withKnownValue)}`);
console.log(`Bez uvedené hodnoty:    ${cz(report.withoutKnownValue)}`);
console.log(`Známá hodnota celkem:   ${money(report.knownValueCzk)}`);
console.log(`Protistrany:             ${cz(report.uniqueCounterparties)}`);
console.log(`Chybí datum/předmět/protistrana/URL: ${missing.signed}/${missing.subject}/${missing.counterparty}/${missing.url}`);
console.log(`Jiné IČO publikujícího subjektu: ${report.wrongPublisherIco}`);
console.log('\n10 smluv pro ruční kontrolu 1:1:');
for(const [i,c] of report.sample.entries()){
 console.log(`\n${i+1}. ${c.signed||'bez data'} · ${c.counterparty||'bez protistrany'} · ${c.valueCzk?money(c.valueCzk):'hodnota neuvedena'}`);
 console.log(`   ${c.subject}`); console.log(`   idVerze ${c.id}${c.idContract?` · idSmlouvy ${c.idContract}`:''}`); console.log(`   ${c.url}`);
}
console.log('\n✓ QA report uložen do data/contracts-qa.json');
