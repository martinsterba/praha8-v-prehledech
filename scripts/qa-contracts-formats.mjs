import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const INDEX='https://data.smlouvy.gov.cz/index.xml';
const TARGET_ICO='00063797';
const TARGET_DS='g5ybpd2';
const UA='Mozilla/5.0 Praha8Prehledy/2.5.5 QA-legacy';
const TESTS=[['2016','07'],['2016','12'],['2026','06']].map(([year,month])=>({year,month,period:`${year}-${month}`}));

const unesc=s=>String(s||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&apos;/g,"'").trim();
const tag=(xml,name)=>{const m=String(xml||'').match(new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${name}>`,'i'));return m?unesc(m[1].replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim():''};
const blocks=(xml,name)=>[...String(xml||'').matchAll(new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${name}>`,'gi'))].map(m=>m[1]);
const block=(xml,name)=>blocks(xml,name)[0]||'';
const normIco=s=>{const n=String(s||'').replace(/\D/g,'');return n?n.padStart(8,'0'):''};
const entityFrom=b=>({name:tag(b,'nazev')||tag(b,'nazevSubjektu')||tag(b,'jmeno')||tag(b,'obchodniJmeno'),ico:normIco(tag(b,'ico')||tag(b,'ic')),box:tag(b,'datovaSchranka')||tag(b,'datovaSchrankaId')||tag(b,'idDatoveSchranky')});
const isTarget=e=>normIco(e?.ico)===TARGET_ICO||String(e?.box||'').toLowerCase()===TARGET_DS;

function modernPublisherOf(z){
  for(const n of ['VkladatelDoRejstriku','vkladatelDoRejstriku','publikujiciSmluvniStrana','PublikujiciSmluvniStrana','vkladatel','Vkladatel']){
    for(const b of blocks(z,n)){const e=entityFrom(b);if(e.name||e.ico||e.box)return {mode:'modern',tag:n,...e}}
  }
  // Důležité: ve starém XML může být víc elementů <smlouva>; proto fallback nehledá
  // nejprve první smlouvu, ale přímo všechny elementy subjekt v celém záznamu.
  for(const sb of blocks(z,'subjekt')){const e=entityFrom(sb);if(e.name||e.ico||e.box)return {mode:'modern-fallback',tag:'subjekt',...e}}
  return null;
}
function legacyTargetPartyOf(z){
  // 2016-07: IČO/DS Prahy 8 leží v zaznam/smlouva/smluvniStrana.
  // Hledáme smluvniStrana přímo v celém záznamu, nikoli v prvním <smlouva> bloku.
  for(const sb of blocks(z,'smluvniStrana')){const e=entityFrom(sb);if(isTarget(e))return {mode:'legacy-party',tag:'smlouva/smluvniStrana',...e}}
  return null;
}
function classifyTarget(z){
  const modern=modernPublisherOf(z);
  if(modern&&isTarget(modern))return modern;
  // Starý fallback používáme jen když moderní publikující subjekt není dostupný.
  if(!modern){const legacy=legacyTargetPartyOf(z);if(legacy)return legacy}
  return null;
}
function contractBody(z){
  const all=blocks(z,'smlouva');
  return all.find(b=>tag(b,'predmet')||tag(b,'datumUzavreni')||blocks(b,'smluvniStrana').length)||all[0]||z;
}
async function fetchText(url,timeout=240000){const r=await fetch(url,{headers:{'user-agent':UA,'accept':'application/xml,text/xml,*/*'},signal:AbortSignal.timeout(timeout)});if(!r.ok)throw new Error(`${url}: HTTP ${r.status}`);return await r.text()}

console.log('QA nejstaršího formátu Registru smluv — v2.5.5');
console.log('────────────────────────────────────────────────────────');
console.log(`MČ Praha 8: IČO ${TARGET_ICO} / DS ${TARGET_DS}`);
console.log('Oprava: historické smluvniStrana hledáme přímo v celém <zaznam>, ne uvnitř prvního <smlouva>.');
console.log('Full-history se stále NESPOUŠTÍ. Testujeme 2016-07 + dvě regrese.\n');

const index=await fetchText(INDEX,60000);
let urls=[...index.matchAll(/<(?:(?:[\w.-]+):)?odkaz\b[^>]*>([\s\S]*?)<\/(?:(?:[\w.-]+):)?odkaz>/gi)].map(m=>unesc(m[1]));
if(!urls.length)urls=[...index.matchAll(/https?:\/\/[^\s<"']*dump_\d{4}_\d{2}\.xml/gi)].map(m=>m[0]);
urls=[...new Set(urls)];
const reports=[];
for(let ti=0;ti<TESTS.length;ti++){
  const t=TESTS[ti],url=urls.find(x=>new RegExp(`dump_${t.year}_${t.month}\\.xml`,'i').test(x));
  if(!url){console.log(`⚠️ ${t.period}: dump nenalezen`);continue}
  console.log(`\n[${ti+1}/${TESTS.length}] ${t.period}`);
  const xml=await fetchText(url),mb=Buffer.byteLength(xml)/1024/1024;
  console.log(`Staženo ${mb.toFixed(1)} MB · ${url}`);
  const re=/<(?:(?:[\w.-]+):)?zaznam\b[^>]*>([\s\S]*?)<\/(?:(?:[\w.-]+):)?zaznam>/gi;
  let m,total=0,valid=0,rawTargetRecords=0,targetAny=0,targetValid=0,modern=0,legacy=0;
  const samples=[];
  while((m=re.exec(xml))){
    total++;const z=m[1];const vt=(tag(z,'platnyZaznam')||'true').toLowerCase();const ok=!['false','0','ne'].includes(vt);if(ok)valid++;
    if(z.includes(TARGET_ICO)||z.toLowerCase().includes(TARGET_DS))rawTargetRecords++;
    const hit=classifyTarget(z);if(!hit)continue;targetAny++;if(ok)targetValid++;if(hit.mode==='legacy-party')legacy++;else modern++;
    if(samples.length<5){const ident=block(z,'identifikator')||z;const body=contractBody(z);samples.push({valid:ok,mode:hit.mode,idVerze:tag(ident,'idVerze')||tag(z,'idVerze'),subject:tag(body,'predmet'),name:hit.name,ico:hit.ico,box:hit.box})}
  }
  const rawIco=(xml.match(/00063797/g)||[]).length,rawDs=(xml.toLowerCase().match(/g5ybpd2/g)||[]).length;
  const captured=rawTargetRecords===0||targetAny>0;
  console.log(`XML záznamů ${total.toLocaleString('cs-CZ')} · platných ${valid.toLocaleString('cs-CZ')}`);
  console.log(`Raw IČO/DS ${rawIco}/${rawDs} · raw záznamů P8 ${rawTargetRecords}`);
  console.log(`Parser P8: všechny ${targetAny} · platné ${targetValid} · moderní ${modern} · historické ${legacy}`);
  console.log(`Stav: ${captured?'✅ ROZPOZNÁNO':'❌ NEROZPOZNÁNO'}`);
  if(samples.length){console.log('Vzorky:');for(const s of samples)console.log(`  ${s.valid?'platný':'NEPLATNÝ'} · ${s.mode} · idVerze ${s.idVerze||'-'} · ${s.subject||'-'} · ${s.name||'-'} · IČO ${s.ico||'-'} · DS ${s.box||'-'}`)}
  reports.push({period:t.period,url,sizeMb:Number(mb.toFixed(1)),total,valid,rawIco,rawDs,rawTargetRecords,targetAny,targetValid,modern,legacy,captured,samples});
}
console.log('\n────────────────────────────────────────────────────────');
console.log('SOUHRN');
for(const r of reports)console.log(`${r.period}: raw P8 ${r.rawTargetRecords} · parser ${r.targetValid} platných · moderní ${r.modern} / historické ${r.legacy} · ${r.captured?'✅':'❌'}`);
const old=reports.find(r=>r.period==='2016-07');const mid=reports.find(r=>r.period==='2016-12');const modern=reports.find(r=>r.period==='2026-06');
const pass=Boolean(old?.targetAny>0 && mid?.targetValid===1 && modern?.targetValid===103);
console.log(`\nKontrola 2016-07: parser našel ${old?.targetAny??'-'} z raw ${old?.rawTargetRecords??'-'} ${old?.targetAny>0?'✅':'❌'}`);
console.log(`Regrese 2016-12: ${mid?.targetValid??'-'} platných / oček. 1 ${mid?.targetValid===1?'✅':'❌'}`);
console.log(`Regrese 2026-06: ${modern?.targetValid??'-'} platných / oček. 103 ${modern?.targetValid===103?'✅':'❌'}`);
if(pass){console.log('\n✅ Historická větev konečně rozpoznává nejstarší formát a obě regrese sedí.');console.log('➡️ Další krok: full-history bootstrap s oběma větvemi parseru.')}else{console.log('\n❌ Ještě nepouštět full-history. Potřebujeme další diagnostiku nejstaršího formátu.');process.exitCode=2}
await writeFile(resolve(root,'data/contracts-formats-qa.json'),JSON.stringify({generatedAt:new Date().toISOString(),version:'2.5.5',targetIco:TARGET_ICO,targetDs:TARGET_DS,reports,pass},null,2));
console.log('\n✓ Report uložen do data/contracts-formats-qa.json');
