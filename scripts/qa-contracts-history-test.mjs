import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const INDEX='https://data.smlouvy.gov.cz/index.xml';
const TARGET_ICO='00063797';
const TARGET_DS='g5ybpd2';
const UA='Mozilla/5.0 Praha8Prehledy/2.5.2 QA';

// 2026-06 je náš ověřený současný kontrolní bod: celý publikační dump obsahuje 103 platných záznamů MČ Praha 8.
// 2016-07 záměrně nemá očekávaný počet. Chceme zjistit, zda nula ve full-history běhu byla legitimní,
// nebo zda starší XML používá strukturu, kterou parser nerozpoznává.
const TESTS=[
  {year:'2016',month:'07',expected:null,label:'starší kontrolní dump'},
  {year:'2026',month:'06',expected:103,label:'ověřený moderní dump'}
];

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

console.log('QA kompatibility dumpů Registru smluv — starý vs. nový formát');
console.log('──────────────────────────────────────────────────────────');
console.log('Cíl: před 24,7GB full-history během ověřit, že parser neztrácí Prahu 8 ve starých XML.');
console.log(`Kontrolujeme IČO ${TARGET_ICO} / DS ${TARGET_DS}.\n`);

const index=await fetchText(INDEX,60000);
let urls=[...index.matchAll(/<(?:(?:[\w.-]+):)?odkaz\b[^>]*>([\s\S]*?)<\/(?:(?:[\w.-]+):)?odkaz>/gi)].map(m=>unesc(m[1]));
if(!urls.length)urls=[...index.matchAll(/https?:\/\/[^\s<"']*dump_\d{4}_\d{2}\.xml/gi)].map(m=>m[0]);
urls=[...new Set(urls)];

const reports=[];
for(const test of TESTS){
  const period=`${test.year}-${test.month}`;
  const wanted=new RegExp(`dump_${test.year}_${test.month}\\.xml`,'i');
  const url=urls.find(x=>wanted.test(x));
  if(!url)throw new Error(`V indexu jsem nenašel dump ${period}.`);

  console.log(`\n${period} — ${test.label}`);
  console.log(`Dump: ${url}`);
  const xml=await fetchText(url);
  const mb=Buffer.byteLength(xml)/1024/1024;
  console.log(`Staženo: ${mb.toFixed(1)} MB XML`);

  const recordRe=/<(?:(?:[\w.-]+):)?zaznam\b[^>]*>([\s\S]*?)<\/(?:(?:[\w.-]+):)?zaznam>/gi;
  let m;
  let total=0,valid=0,targetValid=0,targetAny=0,noPublisher=0;
  const publisherTags=new Map();
  const samples=[];
  const rawIco=(xml.match(/00063797/g)||[]).length;
  const rawDs=(xml.toLowerCase().match(/g5ybpd2/g)||[]).length;

  while((m=recordRe.exec(xml))){
    total++;
    const z=m[1];
    const validText=(tag(z,'platnyZaznam')||'true').toLowerCase();
    const isValid=!['false','0','ne'].includes(validText);
    if(isValid)valid++;
    const pub=publisherOf(z);
    if(!pub){noPublisher++;continue;}
    publisherTags.set(pub.tag,(publisherTags.get(pub.tag)||0)+1);
    if(isTarget(pub)){
      targetAny++;
      if(isValid)targetValid++;
      if(samples.length<4){
        const ident=block(z,'identifikator')||z;
        samples.push({
          valid:isValid,publisherTag:pub.tag,publisher:pub.name,ico:pub.ico,box:pub.box,
          idVerze:tag(ident,'idVerze')||tag(z,'idVerze'),
          idSmlouvy:tag(ident,'idSmlouvy')||tag(z,'idSmlouvy'),
          predmet:tag(block(z,'smlouva')||z,'predmet')
        });
      }
    }
  }

  const suspiciousZero=targetValid===0 && (rawIco>0 || rawDs>0);
  const expectedOk=test.expected==null?null:targetValid===test.expected;
  console.log(`XML záznamů: ${total.toLocaleString('cs-CZ')} · platných: ${valid.toLocaleString('cs-CZ')}`);
  console.log(`Raw výskyt IČO/DS Prahy 8: ${rawIco}/${rawDs}`);
  console.log(`Rozpoznaná MČ Praha 8: všechny ${targetAny} · platné ${targetValid}`);
  console.log(`Záznamů bez rozpoznaného vkladatele: ${noPublisher.toLocaleString('cs-CZ')}`);
  if(test.expected!=null)console.log(`Kontrolní očekávání: ${test.expected} → ${expectedOk?'✅ SHODA':'❌ NESHODA'}`);
  if(suspiciousZero){
    console.log('❌ VAROVÁNÍ: raw XML Prahu 8 obsahuje, ale parser našel 0 platných záznamů. Starý formát parser neumí správně.');
  }else if(targetValid===0){
    console.log('✅ Nula vypadá legitimně: v raw XML není ani IČO, ani datová schránka Prahy 8.');
  }else{
    console.log('✅ Parser Prahu 8 v tomto dumpu rozpoznává.');
  }
  console.log('Použité struktury vkladatele: '+([...publisherTags.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v])=>`${k}=${v}`).join(', ')||'žádné'));
  if(samples.length){
    console.log('Vzorky Prahy 8:');
    for(const x of samples)console.log(`  ${x.valid?'platný':'NEPLATNÝ'} · ${x.publisherTag} · idVerze ${x.idVerze||'-'} · ${x.predmet||'-'}`);
  }

  reports.push({period,url,sizeMb:Number(mb.toFixed(1)),total,valid,rawIco,rawDs,noPublisher,targetAny,targetValid,expected:test.expected,expectedOk,suspiciousZero,publisherTags:Object.fromEntries(publisherTags),samples});
}

const old=reports.find(x=>x.period==='2016-07');
const modern=reports.find(x=>x.period==='2026-06');
console.log('\n──────────────────────────────────────────────────────────');
console.log('ZÁVĚR');
if(modern?.expectedOk===false){
  console.log(`❌ Moderní kontrolní bod neprošel: 2026-06 = ${modern.targetValid}/103. Full-history sync NESPouštět.`);
  process.exitCode=2;
}else if(old?.suspiciousZero){
  console.log('❌ Starý dump obsahuje identifikátory Prahy 8, ale parser je neumí přiřadit. Full-history sync NESPouštět; upravíme parser pro starý XML formát.');
  process.exitCode=2;
}else{
  console.log(`✅ 2026-06 prošel (${modern?.targetValid}/103) a 2016-07 nevykazuje známku skryté chyby parseru.`);
  console.log(`   Výsledek 2016-07: ${old?.targetValid??'-'} platných záznamů MČ Praha 8; raw IČO/DS ${old?.rawIco??'-'}/${old?.rawDs??'-'}.`);
  console.log('   Pokud je 2016-07 nula a raw identifikátory jsou také nula, můžeme ji považovat za legitimní a posunout se k širšímu historickému testu.');
}

await writeFile(resolve(root,'data/contracts-history-test.json'),JSON.stringify({generatedAt:new Date().toISOString(),targetIco:TARGET_ICO,targetDs:TARGET_DS,reports},null,2));
console.log('\n✓ Report uložen do data/contracts-history-test.json');
