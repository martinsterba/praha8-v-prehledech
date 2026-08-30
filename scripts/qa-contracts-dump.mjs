import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const INDEX='https://data.smlouvy.gov.cz/index.xml';
const TARGET_ICO='00063797';
const TARGET_DS='g5ybpd2';
const TEST_YEAR='2026';
const TEST_MONTH='06';
const EXPECTED=76;
const UA='Mozilla/5.0 Praha8Prehledy/2.5.1 QA';

const unesc=s=>String(s||'')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1')
  .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&')
  .replace(/&quot;/g,'"').replace(/&apos;/g,"'").trim();
const tag=(xml,name)=>{const m=String(xml||'').match(new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${name}>`,'i'));return m?unesc(m[1].replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim():''};
const block=(xml,name)=>{const m=String(xml||'').match(new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${name}>`,'i'));return m?m[1]:''};
const normIco=s=>{const n=String(s||'').replace(/\D/g,'');return n?n.padStart(8,'0'):''};
const entityFrom=b=>({
  name:tag(b,'nazev')||tag(b,'nazevSubjektu')||tag(b,'jmeno'),
  ico:normIco(tag(b,'ico')),
  box:tag(b,'datovaSchranka')||tag(b,'datovaSchrankaId')
});
const isTarget=e=>normIco(e?.ico)===TARGET_ICO||String(e?.box||'').toLowerCase()===TARGET_DS;
const publisherOf=z=>{
  for(const n of ['VkladatelDoRejstriku','vkladatelDoRejstriku','publikujiciSmluvniStrana','PublikujiciSmluvniStrana','vkladatel']){
    const b=block(z,n);if(b){const e=entityFrom(b);if(e.name||e.ico||e.box)return {tag:n,...e};}
  }
  const smlouva=block(z,'smlouva'); const sb=block(smlouva,'subjekt');
  if(sb){const e=entityFrom(sb);if(e.name||e.ico||e.box)return {tag:'smlouva/subjekt (fallback)',...e};}
  return null;
};

async function fetchText(url,timeout=240000){
  const r=await fetch(url,{headers:{'user-agent':UA,'accept':'application/xml,text/xml,*/*'},signal:AbortSignal.timeout(timeout)});
  if(!r.ok)throw new Error(`${url}: HTTP ${r.status}`);
  return await r.text();
}

console.log(`QA jednoho dumpu Registru smluv — ${TEST_YEAR}-${TEST_MONTH}`);
console.log('────────────────────────────────────────────────────────');
console.log(`Kontrolní bod: očekáváme ${EXPECTED} platných verzí publikovaných MČ Praha 8 (IČO ${TARGET_ICO}).`);
console.log('Načítám pouze jeden měsíční dump; ostatní data se nesynchronizují.\n');

const index=await fetchText(INDEX,60000);
let urls=[...index.matchAll(/<(?:(?:[\w.-]+):)?odkaz\b[^>]*>([\s\S]*?)<\/(?:(?:[\w.-]+):)?odkaz>/gi)].map(m=>unesc(m[1]));
if(!urls.length)urls=[...index.matchAll(/https?:\/\/[^\s<"']*dump_\d{4}_\d{2}\.xml/gi)].map(m=>m[0]);
const wanted=new RegExp(`dump_${TEST_YEAR}_${TEST_MONTH}\\.xml`,'i');
const url=[...new Set(urls)].find(x=>wanted.test(x));
if(!url)throw new Error(`V indexu jsem nenašel dump ${TEST_YEAR}-${TEST_MONTH}.`);
console.log(`Dump: ${url}`);
const xml=await fetchText(url);
console.log(`Staženo: ${(Buffer.byteLength(xml)/1024/1024).toFixed(1)} MB XML\n`);

const recordRe=/<(?:(?:[\w.-]+):)?zaznam\b[^>]*>([\s\S]*?)<\/(?:(?:[\w.-]+):)?zaznam>/gi;
let m;
let total=0, valid=0, targetValid=0, targetAny=0, noPublisher=0;
const publisherTags=new Map();
const publisherIcos=new Map();
const targetSamples=[];
const rawTargetOccurrences=(xml.match(/00063797/g)||[]).length;
const rawDsOccurrences=(xml.toLowerCase().match(/g5ybpd2/g)||[]).length;

while((m=recordRe.exec(xml))){
  total++;
  const z=m[1];
  const validText=(tag(z,'platnyZaznam')||'true').toLowerCase();
  const isValid=!['false','0','ne'].includes(validText);
  if(isValid)valid++;
  const pub=publisherOf(z);
  if(!pub){noPublisher++;continue;}
  publisherTags.set(pub.tag,(publisherTags.get(pub.tag)||0)+1);
  if(pub.ico)publisherIcos.set(pub.ico,(publisherIcos.get(pub.ico)||0)+1);
  if(isTarget(pub)){
    targetAny++;
    if(isValid)targetValid++;
    if(targetSamples.length<5){
      const ident=block(z,'identifikator')||z;
      targetSamples.push({
        valid:isValid,
        publisherTag:pub.tag,
        publisher:pub.name,
        ico:pub.ico,
        box:pub.box,
        idVerze:tag(ident,'idVerze')||tag(z,'idVerze'),
        idSmlouvy:tag(ident,'idSmlouvy')||tag(z,'idSmlouvy'),
        predmet:tag(block(z,'smlouva')||z,'predmet')
      });
    }
  }
}

console.log('DIAGNOSTIKA');
console.log(`  XML záznamů celkem:                 ${total.toLocaleString('cs-CZ')}`);
console.log(`  Platných záznamů celkem:            ${valid.toLocaleString('cs-CZ')}`);
console.log(`  Raw výskyt IČO ${TARGET_ICO}:          ${rawTargetOccurrences.toLocaleString('cs-CZ')}`);
console.log(`  Raw výskyt DS ${TARGET_DS}:            ${rawDsOccurrences.toLocaleString('cs-CZ')}`);
console.log(`  Záznamů bez rozpoznaného vkladatele: ${noPublisher.toLocaleString('cs-CZ')}`);
console.log(`  MČ Praha 8 jako vkladatel (všechny): ${targetAny.toLocaleString('cs-CZ')}`);
console.log(`  MČ Praha 8 jako vkladatel (platné):  ${targetValid.toLocaleString('cs-CZ')}`);
console.log(`  Očekávání:                           ${EXPECTED}`);
console.log(`  Výsledek:                            ${targetValid===EXPECTED?'✅ SHODA':'❌ NESHODA'} (${targetValid}/${EXPECTED})\n`);

console.log('Použité struktury pro vkladatele:');
for(const [k,v] of [...publisherTags.entries()].sort((a,b)=>b[1]-a[1]))console.log(`  ${k}: ${v.toLocaleString('cs-CZ')}`);

console.log('\nNejčastější IČO rozpoznaného vkladatele (kontrolní vzorek):');
for(const [ico,count] of [...publisherIcos.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12))console.log(`  ${ico}: ${count.toLocaleString('cs-CZ')}`);

console.log('\nPrvních několik záznamů MČ Praha 8:');
for(const [i,x] of targetSamples.entries()){
  console.log(`  ${i+1}. ${x.valid?'platný':'NEPLATNÝ'} · ${x.publisherTag} · ${x.publisher||'-'} · IČO ${x.ico||'-'} · DS ${x.box||'-'}`);
  console.log(`     idVerze ${x.idVerze||'-'} · idSmlouvy ${x.idSmlouvy||'-'} · ${x.predmet||'-'}`);
}

const report={period:`${TEST_YEAR}-${TEST_MONTH}`,expected:EXPECTED,totalRecords:total,validRecords:valid,rawTargetOccurrences,rawDsOccurrences,noPublisher,targetAny,targetValid,match:targetValid===EXPECTED,publisherTags:Object.fromEntries(publisherTags),topPublisherIcos:[...publisherIcos.entries()].sort((a,b)=>b[1]-a[1]).slice(0,30).map(([ico,count])=>({ico,count})),samples:targetSamples,generatedAt:new Date().toISOString(),dumpUrl:url};
await writeFile(resolve(root,'data/contracts-dump-qa.json'),JSON.stringify(report,null,2));
console.log('\n✓ QA report uložen do data/contracts-dump-qa.json');
if(targetValid!==EXPECTED){
  console.log('\nDalší krok: podle diagnostiky opravíme parser. Celou 24,7GB historii zatím NESPouštíme.');
  process.exitCode=2;
}else{
  console.log('\nKontrolní bod prošel. Parser umí známý dump 2026-06 přečíst správně; teprve teď má smysl testovat starší měsíce / celou historii.');
}
