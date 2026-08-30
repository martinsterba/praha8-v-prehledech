import {readFile, writeFile, rename} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const DATA=resolve(root,'data','smlouvy.json');
const STATE=resolve(root,'data','contracts-sync-state.json');
const INDEX='https://data.smlouvy.gov.cz/index.xml';
const TARGET_ICO='00063797', TARGET_DS='g5ybpd2';
const UA='Praha8-v-prehledech/3.0.2 (+public-data-indexer; public sources only)';
const PLAN=process.argv.includes('--plan');
const INIT=process.argv.includes('--init-state');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const unesc=s=>String(s||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&apos;/g,"'").trim();
const values=(xml,name)=>[...String(xml||'').matchAll(new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${name}>`,'gi'))].map(m=>unesc(m[1].replace(/<[^>]+>/g,' ')).trim());
const tag=(xml,name)=>values(xml,name)[0]||'';
const block=(xml,name)=>{const m=String(xml||'').match(new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${name}>`,'i'));return m?m[1]:''};
const blocks=(xml,name)=>[...String(xml||'').matchAll(new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${name}>`,'gi'))].map(m=>m[1]);
const normIco=s=>String(s||'').replace(/\D/g,'').padStart(8,'0');
const val=s=>{const n=Number(String(s||'').replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)&&n>0?n:null};
const iso=s=>{const x=String(s||'').trim();if(!x)return '';const m=x.match(/^(\d{4}-\d{2}-\d{2})/);if(m)return m[1];const c=x.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);return c?`${c[3]}-${c[2].padStart(2,'0')}-${c[1].padStart(2,'0')}`:''};
const monthOf=x=>String(x||'').slice(0,7);
const entityFrom=b=>({name:tag(b,'nazev')||tag(b,'nazevSubjektu')||tag(b,'jmeno'),ico:normIco(tag(b,'ico')),box:tag(b,'datovaSchranka')||tag(b,'datovaSchrankaId')});
const isTarget=e=>normIco(e?.ico)===TARGET_ICO||String(e?.box||'').toLowerCase()===TARGET_DS;
function publisherOf(z){
  for(const n of ['VkladatelDoRejstriku','vkladatelDoRejstriku','publikujiciSmluvniStrana','PublikujiciSmluvniStrana','vkladatel']){const b=block(z,n);if(b){const e=entityFrom(b);if(e.name||e.ico||e.box)return e}}
  for(const sb of blocks(z,'subjekt')){const e=entityFrom(sb);if(e.name||e.ico||e.box)return e}
  return null;
}
function contractBodyOf(z){const all=blocks(z,'smlouva');return all.find(b=>tag(b,'predmet')||tag(b,'datumUzavreni')||blocks(b,'smluvniStrana').length)||all[0]||z}
function partiesOf(z){const out=[],smlouva=contractBodyOf(z);for(const b of [...blocks(smlouva,'smluvniStrana'),...blocks(z,'smluvniStrana')]){const e=entityFrom(b);if((e.name||e.ico)&&!isTarget(e))out.push(e)}if(!out.length){const sb=block(smlouva,'smluvniStrany')||block(smlouva,'SmluvniStrany');if(sb)for(const b of blocks(sb,'subjekt')){const e=entityFrom(b);if((e.name||e.ico)&&!isTarget(e))out.push(e)}}const seen=new Set();return out.filter(e=>{const k=e.ico||String(e.name||'').toLowerCase();if(!k||seen.has(k))return false;seen.add(k);return true})}
function parseRecord(z){
  const valid=(tag(z,'platnyZaznam')||'true').toLowerCase();if(['false','0','ne'].includes(valid))return null;
  const pub=publisherOf(z);if(!pub||!isTarget(pub))return null;
  const smlouva=contractBodyOf(z),parties=partiesOf(z),ident=block(z,'identifikator')||z;
  const idVerze=tag(ident,'idVerze')||tag(z,'idVerze'),idSmlouvy=tag(ident,'idSmlouvy')||tag(z,'idSmlouvy');
  let url=tag(z,'odkaz');if(!/\/smlouva\/\d+/.test(url)&&idVerze)url=`https://smlouvy.gov.cz/smlouva/${idVerze}`;
  const valueVat=val(tag(smlouva,'hodnotaVcetneDph')),valueNoVat=val(tag(smlouva,'hodnotaBezDph'));
  return {id:idVerze||idSmlouvy||url,idContract:idSmlouvy||'',url,subject:tag(smlouva,'predmet')||'Smlouva',published:iso(tag(z,'casZverejneni')||tag(z,'datumPublikace')),signed:iso(tag(smlouva,'datumUzavreni')),valueCzk:valueVat??valueNoVat,valueVatCzk:valueVat,valueNoVatCzk:valueNoVat,counterparties:parties,counterparty:parties.map(x=>x.name).filter(Boolean).join(', '),publisher:pub.name||'Městská část Praha 8',publisherIco:pub.ico||TARGET_ICO};
}
async function fetchText(url,attempts=3,timeout=240000){let last;for(let i=1;i<=attempts;i++){try{const r=await fetch(url,{headers:{'user-agent':UA,'accept':'application/xml,text/xml,*/*'},signal:AbortSignal.timeout(timeout)});if(!r.ok)throw new Error(`${url}: HTTP ${r.status}`);return await r.text()}catch(e){last=e;if(i<attempts){await sleep(1500*i)}}}throw last}
function parseIndex(index){
  const years=values(index,'rok'),months=values(index,'mesic'),hashes=values(index,'hashDumpu'),sizes=values(index,'velikostDumpu'),generated=values(index,'casGenerovani'),done=values(index,'dokoncenyMesic'),urls=values(index,'odkaz').filter(x=>/dump_\d{4}_\d{2}\.xml/i.test(x));
  const n=urls.length; if(!n)throw new Error('Index Registru smluv neobsahuje měsíční dumpy.');
  const entries=[];
  for(let i=0;i<n;i++){
    const m=urls[i].match(/dump_(\d{4})_(\d{2})/);const label=`${m?.[1]||years[i]||'?'}-${m?.[2]||String(months[i]||'').padStart(2,'0')}`;
    entries.push({month:label,url:urls[i],hash:hashes[i]||'',size:Number(sizes[i]||0),generated:generated[i]||'',complete:String(done[i]||'')==='1'});
  }
  return entries.sort((a,b)=>a.month.localeCompare(b.month));
}
function summarize(items){
  const partnerMap=new Map();for(const c of items){for(const p of c.counterparties||[]){const key=p.ico||String(p.name||'').toLowerCase();if(!key)continue;const x=partnerMap.get(key)||{name:p.name,ico:p.ico||'',contracts:0,knownValueCzk:0,valuedContracts:0};x.contracts++;if(c.valueCzk!=null&&(c.counterparties||[]).length===1){x.knownValueCzk+=c.valueCzk;x.valuedContracts++}partnerMap.set(key,x)}}
  const partners=[...partnerMap.values()].sort((a,b)=>b.knownValueCzk-a.knownValueCzk||b.contracts-a.contracts||a.name.localeCompare(b.name,'cs'));const known=items.filter(x=>x.valueCzk!=null);const signed=items.map(x=>x.signed).filter(Boolean).sort();
  return {partners,knownValueCzk:known.reduce((n,x)=>n+x.valueCzk,0),valuedContracts:known.length,dateFrom:signed[0]||'2016-07-01',dateTo:signed.at(-1)||new Date().toISOString().slice(0,10)};
}
async function atomicJson(path,data){const tmp=`${path}.tmp`;await writeFile(tmp,JSON.stringify(data,null,2));await rename(tmp,path)}

console.log('\nREGISTR SMLUV — INKREMENTÁLNÍ SYNC — v3.0.2');
console.log('────────────────────────────────────────────');
console.log('Načítám pouze malý index Registru smluv…');
const index=await fetchText(INDEX,3,60000);const entries=parseIndex(index);const open=entries.filter(x=>!x.complete);
let state=null;try{state=JSON.parse(await readFile(STATE,'utf8'))}catch{}
let data=null;try{data=JSON.parse(await readFile(DATA,'utf8'))}catch{}
const baselineOk=data && !Array.isArray(data) && data?.meta?.historyComplete===true && Array.isArray(data.contracts);

if(INIT){
  if(!baselineOk)throw new Error('Nelze inicializovat stav: data/smlouvy.json ještě není kompletní historický dataset. Nejdřív proveďte jednorázový bootstrap.');
  const payload={schema:1,updated:new Date().toISOString(),source:INDEX,dumps:Object.fromEntries(entries.map(x=>[x.month,{hash:x.hash,size:x.size,generated:x.generated,complete:x.complete,url:x.url}]))};
  await atomicJson(STATE,payload);console.log(`✅ Stav inicializován pro ${entries.length} měsíčních dumpů.`);process.exit(0);
}

const prev=state?.dumps||{};
const changed=entries.filter(x=>!prev[x.month] || (x.hash&&prev[x.month]?.hash!==x.hash) || (!x.complete));
const totalSize=changed.reduce((n,x)=>n+(x.size||0),0);
console.log(`Index: ${entries.length} měsíců · otevřené/průběžné: ${open.map(x=>x.month).join(', ')||'žádný'}.`);
if(!state)console.log('Stav předchozího syncu zatím neexistuje.');
console.log(`Podle indexu by se při tomto běhu zkontrolovalo ${changed.length} dumpů${totalSize?` · cca ${(totalSize/1024/1024/1024).toFixed(2)} GB XML`:''}.`);
if(PLAN){
  console.log(changed.length?`Měsíce: ${changed.map(x=>x.month).join(', ')}`:'Žádné změněné měsíce.');
  console.log(baselineOk?'✅ Historický základ je připravený.':'ℹ️ Historický základ v této testovací verzi není připravený; plán nic nestahuje a nic nepřepisuje.');
  process.exit(0);
}
if(!baselineOk)throw new Error('Inkrementální sync odmítnut: chybí kompletní historický základ. Tím chráníme web před neúplným datasetem.');
if(!state)throw new Error('Inkrementální sync odmítnut: chybí contracts-sync-state.json. Po bootstrapu jednou spusťte npm run sync:contracts:init.');
if(!changed.length){console.log('✅ Žádná změna. Existující dataset zůstal beze změny.');process.exit(0)}

let merged=[...data.contracts];
for(const entry of changed){
  console.log(`Stahuji ${entry.month}${entry.complete?'':' (průběžný měsíc)'}…`);
  const xml=await fetchText(entry.url);const re=/<(?:(?:[\w.-]+):)?zaznam\b[^>]*>([\s\S]*?)<\/(?:(?:[\w.-]+):)?zaznam>/gi;let x;const monthItems=[];
  while((x=re.exec(xml))){const item=parseRecord(x[1]);if(item?.id)monthItems.push(item)}
  // Dump je autoritativní pro měsíc publikace. Proto z datasetu nejprve odstraníme
  // všechny záznamy tohoto měsíce a nahradíme je právě aktuální podobou dumpu.
  merged=merged.filter(c=>monthOf(c.published)!==entry.month);
  const byContract=new Map();for(const c of monthItems){const key=c.idContract||c.id,old=byContract.get(key);if(!old||(c.published||'')>(old.published||'')||Number(c.id)>Number(old.id))byContract.set(key,c)}
  merged.push(...byContract.values());
  console.log(`  ${entry.month}: ${byContract.size.toLocaleString('cs-CZ')} aktuálních smluv MČ Praha 8.`);
}
// Globální deduplikace: případná nová verze smlouvy může být publikována v jiném měsíci.
const byContract=new Map();for(const c of merged){const key=c.idContract||c.id,old=byContract.get(key);if(!old||(c.published||'')>(old.published||'')||Number(c.id)>Number(old.id))byContract.set(key,c)}
const items=[...byContract.values()].sort((a,b)=>(b.published||'').localeCompare(a.published||''));const sum=summarize(items);
const payload={contracts:items,partners:sum.partners,meta:{...data.meta,total:items.length,knownValueCzk:sum.knownValueCzk,valuedContracts:sum.valuedContracts,partners:sum.partners.length,dateFrom:sum.dateFrom,dateTo:sum.dateTo,updated:new Date().toISOString(),method:'open-data-monthly-dumps-incremental-by-index-hash',validation:{status:'open-data-complete',note:'Historický základ je doplňován změněnými měsíčními dumpy. Změny starších dumpů se detekují podle hashDumpu v oficiálním indexu Registru smluv.'}}};
const nextState={schema:1,updated:new Date().toISOString(),source:INDEX,dumps:Object.fromEntries(entries.map(x=>[x.month,{hash:x.hash,size:x.size,generated:x.generated,complete:x.complete,url:x.url}]))};
await atomicJson(DATA,payload);await atomicJson(STATE,nextState);
console.log(`✅ HOTOVO: ${items.length.toLocaleString('cs-CZ')} smluv. Aktualizováno ${changed.length} měsíčních dumpů.`);
