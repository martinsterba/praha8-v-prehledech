import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const UA='Praha8-v-prehledech/2.6.4 (+public-data QA)';
const INDEX='https://data.smlouvy.gov.cz/index.xml';
const P8_ICO='00063797';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const normIco=s=>{const d=String(s||'').replace(/\D/g,'');return d?d.padStart(8,'0'):''};
const unesc=s=>String(s||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&apos;/g,"'").trim();
const tag=(xml,name)=>{const m=String(xml||'').match(new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${name}>`,'i'));return m?unesc(m[1].replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim():''};
const block=(xml,name)=>{const m=String(xml||'').match(new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${name}>`,'i'));return m?m[1]:''};
const blocks=(xml,name)=>[...String(xml||'').matchAll(new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${name}>`,'gi'))].map(m=>m[1]);
const val=s=>{const n=Number(String(s||'').replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)&&n>0?n:null};
const iso=s=>{const x=String(s||'').trim();if(!x)return '';const m=x.match(/^(\d{4}-\d{2}-\d{2})/);if(m)return m[1];const c=x.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);return c?`${c[3]}-${c[2].padStart(2,'0')}-${c[1].padStart(2,'0')}`:''};
const entityFrom=b=>({name:tag(b,'nazev')||tag(b,'nazevSubjektu')||tag(b,'jmeno'),ico:normIco(tag(b,'ico')),box:tag(b,'datovaSchranka')||tag(b,'datovaSchrankaId')});

async function readJson(path){try{return JSON.parse(await readFile(path,'utf8'))}catch{return null}}

async function ensureEntities(){
  let reg=await readJson(resolve(root,'data','contract-entities.json'));
  if(reg?.qa?.status==='verified' && reg?.entities?.length===40)return reg;
  console.log('Entity registry není v této verzi připravený; nejdřív spouštím jeho ověření…');
  const r=spawnSync(process.execPath,['scripts/sync-contract-entities.mjs'],{cwd:root,stdio:'inherit'});
  if(r.status!==0)throw new Error('Entity registry se nepodařilo připravit.');
  reg=await readJson(resolve(root,'data','contract-entities.json'));
  if(reg?.qa?.status!=='verified'||reg?.entities?.length!==40)throw new Error('Entity registry není ověřený 40/40.');
  return reg;
}

async function findReferenceP8(){
  const candidates=[];
  try{
    const parent=resolve(root,'..');
    for(const d of await readdir(parent,{withFileTypes:true})){
      if(!d.isDirectory()||!/^praha8-prehledy-v\d/i.test(d.name)||resolve(parent,d.name)===root)continue;
      const p=resolve(parent,d.name,'data','smlouvy.json'); if(!existsSync(p))continue;
      const x=await readJson(p);
      if(x?.meta?.historyComplete===true && Number(x?.meta?.total)>0)candidates.push({dir:d.name,total:Number(x.meta.total),updated:x.meta.updated||''});
    }
  }catch{}
  candidates.sort((a,b)=>(b.updated||'').localeCompare(a.updated||'')||b.dir.localeCompare(a.dir,undefined,{numeric:true}));
  return candidates[0]||null;
}

const fetchText=async(url,attempts=3,timeout=240000)=>{let last;for(let i=1;i<=attempts;i++){try{const r=await fetch(url,{headers:{'user-agent':UA,'accept':'application/xml,text/xml,*/*'},signal:AbortSignal.timeout(timeout)});if(!r.ok)throw new Error(`${url}: HTTP ${r.status}`);return await r.text()}catch(e){last=e;if(i<attempts){const wait=1500*i;console.log(`      ↻ síťový pokus ${i}/${attempts} selhal, opakuji za ${wait} ms…`);await sleep(wait)}}}throw last};

function publisherOf(z){
  for(const n of ['VkladatelDoRejstriku','vkladatelDoRejstriku','publikujiciSmluvniStrana','PublikujiciSmluvniStrana','vkladatel']){
    const b=block(z,n); if(b){const e=entityFrom(b);if(e.name||e.ico||e.box)return e}
  }
  // Stejná ověřená logika jako u MČ Praha 8: subjekt = publikující subjekt.
  // smluvniStrana je protistrana a NESMÍ se použít jako fallback publikujícího subjektu.
  for(const sb of blocks(z,'subjekt')){const e=entityFrom(sb);if(e.name||e.ico||e.box)return e}
  return null;
}
function contractBodyOf(z){
  const all=blocks(z,'smlouva');
  return all.find(b=>tag(b,'predmet')||tag(b,'datumUzavreni')||blocks(b,'smluvniStrana').length)||all[0]||z;
}
function partiesOf(z,publisherIco){
  const out=[];const smlouva=contractBodyOf(z);
  const partyBlocks=[...blocks(smlouva,'smluvniStrana'),...blocks(z,'smluvniStrana')];
  for(const b of partyBlocks){const e=entityFrom(b);if((e.name||e.ico)&&normIco(e.ico)!==publisherIco)out.push(e)}
  if(!out.length){const sb=block(smlouva,'smluvniStrany')||block(smlouva,'SmluvniStrany');if(sb)for(const b of blocks(sb,'subjekt')){const e=entityFrom(b);if((e.name||e.ico)&&normIco(e.ico)!==publisherIco)out.push(e)}}
  const seen=new Set();return out.filter(e=>{const k=e.ico||String(e.name||'').toLowerCase();if(!k||seen.has(k))return false;seen.add(k);return true});
}
function parseRecord(z,targetByIco){
  const valid=(tag(z,'platnyZaznam')||'true').toLowerCase();if(['false','0','ne'].includes(valid))return null;
  const pub=publisherOf(z);const pubIco=normIco(pub?.ico);const target=targetByIco.get(pubIco);if(!target)return null;
  const smlouva=contractBodyOf(z);const parties=partiesOf(z,pubIco);const ident=block(z,'identifikator')||z;
  const idVerze=tag(ident,'idVerze')||tag(z,'idVerze');const idSmlouvy=tag(ident,'idSmlouvy')||tag(z,'idSmlouvy');
  let url=tag(z,'odkaz');if(!/\/smlouva\/\d+/.test(url)&&idVerze)url=`https://smlouvy.gov.cz/smlouva/${idVerze}`;
  const valueVat=val(tag(smlouva,'hodnotaVcetneDph')),valueNoVat=val(tag(smlouva,'hodnotaBezDph'));
  return {entityIco:pubIco,entityName:target.name,entityKind:target.kind,id:idVerze||idSmlouvy||url,idContract:idSmlouvy||'',url,subject:tag(smlouva,'predmet')||'Smlouva',published:iso(tag(z,'casZverejneni')||tag(z,'datumPublikace')),signed:iso(tag(smlouva,'datumUzavreni')),valueCzk:valueVat??valueNoVat,valueVatCzk:valueVat,valueNoVatCzk:valueNoVat,counterparties:parties,counterparty:parties.map(x=>x.name).filter(Boolean).join(', '),publisher:pub?.name||target.name,publisherIco:pubIco};
}

function summarize(entity,items){
  const partnerMap=new Map();
  for(const c of items)for(const p of c.counterparties||[]){const key=p.ico||String(p.name||'').toLowerCase();if(!key)continue;const x=partnerMap.get(key)||{name:p.name,ico:p.ico||'',contracts:0,knownValueCzk:0,valuedContracts:0};x.contracts++;if(c.valueCzk!=null&&(c.counterparties||[]).length===1){x.knownValueCzk+=c.valueCzk;x.valuedContracts++}partnerMap.set(key,x)}
  const partners=[...partnerMap.values()].sort((a,b)=>b.knownValueCzk-a.knownValueCzk||b.contracts-a.contracts||a.name.localeCompare(b.name,'cs'));
  const known=items.filter(x=>x.valueCzk!=null);const signed=items.map(x=>x.signed).filter(Boolean).sort();
  return {...entity,total:items.length,partners:partners.length,knownValueCzk:known.reduce((n,x)=>n+x.valueCzk,0),valuedContracts:known.length,dateFrom:signed[0]||'',dateTo:signed.at(-1)||'',partnerList:partners,contracts:items.sort((a,b)=>(b.published||'').localeCompare(a.published||''))};
}

console.log('\nREGISTR SMLUV — FULL HISTORY PRO MČ + 40 SUBJEKTŮ — v2.6.4');
console.log('────────────────────────────────────────────────────────');
console.log('Používám STEJNÝ open-data parser a pravidla jako u ověřeného datasetu MČ Praha 8.');
console.log('Jeden měsíční dump se načte jednou a současně se v něm hledá všech 41 cílových IČO.');
console.log('Zdrojové XML se trvale neukládá; cache obsahuje jen vyfiltrované smlouvy cílových subjektů.\n');

const registry=await ensureEntities();
const targets=[registry.municipality,...registry.entities];
const targetByIco=new Map(targets.map(x=>[normIco(x.ico),x]));
if(targetByIco.size!==41)throw new Error(`Očekávám 41 unikátních IČO, mám ${targetByIco.size}.`);
console.log(`Cílové subjekty: ${targets.length} (MČ Praha 8 + ${registry.groups.organizations.length} organizací + ${registry.groups.companies.length} firmy).`);
const reference=await findReferenceP8();
if(reference)console.log(`QA reference MČ Praha 8: ${reference.total.toLocaleString('cs-CZ')} smluv z ${reference.dir}.`);

console.log('Načítám index otevřených dat…');
const index=await fetchText(INDEX,3,60000);
let dumpUrls=[...index.matchAll(/<(?:(?:[\w.-]+):)?odkaz\b[^>]*>([\s\S]*?)<\/(?:(?:[\w.-]+):)?odkaz>/gi)].map(m=>unesc(m[1])).filter(x=>/dump_\d{4}_\d{2}\.xml/i.test(x));
if(!dumpUrls.length)dumpUrls=[...index.matchAll(/https?:\/\/[^\s<"']*dump_\d{4}_\d{2}\.xml/gi)].map(m=>m[0]);
dumpUrls=[...new Set(dumpUrls)].sort((a,b)=>{const A=a.match(/dump_(\d{4})_(\d{2})/),B=b.match(/dump_(\d{4})_(\d{2})/);return `${A?.[1]}-${A?.[2]}`.localeCompare(`${B?.[1]}-${B?.[2]}`)});
if(!dumpUrls.length)throw new Error('Index neobsahuje měsíční dumpy.');
let totalBytes=0;for(const m of index.matchAll(/<(?:(?:[\w.-]+):)?velikostDumpu\b[^>]*>(\d+)<\/[^>]*velikostDumpu>/gi))totalBytes+=Number(m[1]||0);
console.log(`Historie: ${dumpUrls.length} dumpů${totalBytes?` · přibližně ${(totalBytes/1024/1024/1024).toFixed(1)} GB XML jednorázově přes síť`:''}.`);
console.log('Po tomto bootstrapu už budeme pracovat z malé entity-cache a přírůstkových aktualizací.\n');

const cacheDir=resolve(root,'data','cache','contracts-entities-months');await mkdir(cacheDir,{recursive:true});
const byEntity=new Map(targets.map(x=>[normIco(x.ico),new Map()]));
const failed=[];const started=Date.now();let nNet=0,nCache=0;
for(let i=0;i<dumpUrls.length;i++){
  const url=dumpUrls[i],m=url.match(/dump_(\d{4})_(\d{2})/),label=`${m?.[1]||'?'}-${m?.[2]||'?'}`,cacheFile=resolve(cacheDir,`${label}.json`),isLatest=i===dumpUrls.length-1;
  try{
    let monthItems=[],fromCache=false;
    if(!isLatest&&existsSync(cacheFile)){
      try{const c=JSON.parse(await readFile(cacheFile,'utf8'));if(c?.schema===2&&c?.month===label&&Array.isArray(c.items)&&c?.targetFingerprint===targets.map(x=>normIco(x.ico)).sort().join(',')){monthItems=c.items;fromCache=true;nCache++}}catch{}
    }
    if(!fromCache){
      const xml=await fetchText(url);nNet++;const re=/<(?:(?:[\w.-]+):)?zaznam\b[^>]*>([\s\S]*?)<\/(?:(?:[\w.-]+):)?zaznam>/gi;let x;
      while((x=re.exec(xml))){const item=parseRecord(x[1],targetByIco);if(item?.id)monthItems.push(item)}
      if(!isLatest)await writeFile(cacheFile,JSON.stringify({schema:2,month:label,source:url,created:new Date().toISOString(),targetFingerprint:targets.map(x=>normIco(x.ico)).sort().join(','),items:monthItems}));
    }
    for(const item of monthItems){const map=byEntity.get(item.entityIco);if(!map)continue;const key=item.idContract||item.id;const prev=map.get(key);if(!prev||(item.published||'')>(prev.published||'')||Number(item.id)>Number(prev.id))map.set(key,item)}
    const p8=byEntity.get(P8_ICO)?.size||0;const other=[...byEntity.entries()].filter(([ico])=>ico!==P8_ICO).reduce((n,[,x])=>n+x.size,0);
    const elapsed=(Date.now()-started)/1000,per=(i+1)/Math.max(elapsed,.1),remain=(dumpUrls.length-i-1)/Math.max(per,.001);
    console.log(`[${String(i+1).padStart(String(dumpUrls.length).length)}/${dumpUrls.length}] ${label}: ${monthItems.length.toLocaleString('cs-CZ')} cílových záznamů · MČ ${p8.toLocaleString('cs-CZ')} · organizace+firmy ${other.toLocaleString('cs-CZ')} · ${fromCache?'cache':'síť'} · odhad ${Math.max(0,Math.round(remain/60))} min`);
  }catch(e){failed.push(label);console.log(`⚠️ ${label}: ${String(e.message||e).slice(0,180)}`)}
}
console.log(`\nBootstrap: ${nNet} dumpů ze sítě · ${nCache} z entity-cache.`);
if(failed.length)throw new Error(`Neúplný import: selhalo ${failed.length} dumpů (${failed.slice(0,8).join(', ')}${failed.length>8?', …':''}). Finální dataset NEUKLÁDÁM.`);

const summaries=[];
for(const entity of targets){const items=[...(byEntity.get(normIco(entity.ico))||new Map()).values()];summaries.push(summarize(entity,items))}
const p8Summary=summaries.find(x=>normIco(x.ico)===P8_ICO);
const orgs=summaries.filter(x=>x.kind==='organization');const companies=summaries.filter(x=>x.kind==='company');
const extra=summaries.filter(x=>normIco(x.ico)!==P8_ICO);
const extraContracts=extra.reduce((n,x)=>n+x.total,0),extraKnown=extra.reduce((n,x)=>n+x.knownValueCzk,0);

console.log('\nSOUHRN');console.log('────────────────────────────────────────────────────────');
console.log(`MČ Praha 8: ${p8Summary.total.toLocaleString('cs-CZ')} smluv.`);
if(reference){const delta=p8Summary.total-reference.total;console.log(`QA proti ${reference.dir}: ${p8Summary.total.toLocaleString('cs-CZ')} vs. ${reference.total.toLocaleString('cs-CZ')} (${delta>=0?'+':''}${delta}). ${Math.abs(delta)<=10?'✅ v očekávaném průběžném rozdílu':'⚠️ větší rozdíl — před publikací zkontrolovat'}`)}
console.log(`37 organizací: ${orgs.reduce((n,x)=>n+x.total,0).toLocaleString('cs-CZ')} smluv.`);
console.log(`3 firmy: ${companies.reduce((n,x)=>n+x.total,0).toLocaleString('cs-CZ')} smluv.`);
console.log(`Dalších 40 subjektů celkem: ${extraContracts.toLocaleString('cs-CZ')} smluv · známá hodnota ${extraKnown.toLocaleString('cs-CZ')} Kč.`);
console.log('\nSUBJEKTY (abecedně)');
for(const x of extra.sort((a,b)=>a.name.localeCompare(b.name,'cs')))console.log(`${x.kind==='company'?'FIRMA':'ORG  '} ${x.ico} · ${String(x.total).padStart(5)} smluv · ${x.name}`);

const payload={schema:1,updated:new Date().toISOString(),source:INDEX,method:'open-data-monthly-dumps-multi-entity-full-history',meta:{dumps:dumpUrls.length,entities:40,organizations:37,companies:3,totalContracts:extraContracts,knownValueCzk:extraKnown,validation:{status:'open-data-complete',p8Control:{current:p8Summary.total,reference:reference?.total??null,referenceSource:reference?.dir??null,delta:reference?p8Summary.total-reference.total:null},note:'Stejný parser a stejné open-data dumpy jako u MČ Praha 8. smluvniStrana se nikdy nepoužívá jako fallback publikujícího subjektu.'}},entities:extra.map(x=>({...x,partnerList:x.partnerList,contracts:x.contracts}))};
await writeFile(resolve(root,'data','smlouvy-subjekty.json'),JSON.stringify(payload,null,2));
await writeFile(resolve(root,'data','contracts-entities-qa.json'),JSON.stringify({updated:payload.updated,meta:payload.meta,entities:extra.map(({contracts,partnerList,...x})=>x),p8:{total:p8Summary.total,reference}},null,2));
console.log('\n✅ Hotovo. Uloženo data/smlouvy-subjekty.json + data/contracts-entities-qa.json.');
