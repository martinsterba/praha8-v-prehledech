import {readFile,writeFile,rename} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const DATA=resolve(root,'data','smlouvy.json');
const ENTITY_DATA=resolve(root,'data','smlouvy-subjekty.json');
const ENTITY_QA=resolve(root,'data','contracts-entities-qa.json');
const ENTITY_REGISTRY=resolve(root,'data','contract-entities.json');
const SEARCH='https://smlouvy.gov.cz/vyhledavani';
const UA='Praha8-v-prehledech/3.0.13 (+public-data-indexer; public sources only)';
const P8_ICO='00063797';
const DAYS_BACK=5;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

const unesc=s=>String(s||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&apos;/g,"'").trim();
const values=(xml,name)=>[...String(xml||'').matchAll(new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${name}>`,'gi'))].map(m=>unesc(m[1].replace(/<[^>]+>/g,' ')).trim());
const tag=(xml,name)=>values(xml,name)[0]||'';
const block=(xml,name)=>{const m=String(xml||'').match(new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${name}>`,'i'));return m?m[1]:''};
const blocks=(xml,name)=>[...String(xml||'').matchAll(new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${name}>`,'gi'))].map(m=>m[1]);
const normIco=s=>{const d=String(s||'').replace(/\D/g,'');return d?d.padStart(8,'0'):''};
const val=s=>{const n=Number(String(s||'').replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)&&n>0?n:null};
const iso=s=>{const x=String(s||'').trim();if(!x)return '';const m=x.match(/^(\d{4}-\d{2}-\d{2})/);if(m)return m[1];const c=x.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);return c?`${c[3]}-${c[2].padStart(2,'0')}-${c[1].padStart(2,'0')}`:''};
const entityFrom=b=>({name:tag(b,'nazev')||tag(b,'nazevSubjektu')||tag(b,'jmeno'),ico:normIco(tag(b,'ico')),box:tag(b,'datovaSchranka')||tag(b,'datovaSchrankaId')});

async function readJson(path){try{return JSON.parse(await readFile(path,'utf8'))}catch{return null}}
async function atomicJson(path,data){const tmp=`${path}.tmp`;await writeFile(tmp,JSON.stringify(data,null,2));await rename(tmp,path)}
async function fetchText(url,attempts=3,timeout=45000){let last;for(let i=1;i<=attempts;i++){try{const r=await fetch(url,{headers:{'user-agent':UA,'accept':'text/html,application/xhtml+xml,application/xml,text/xml,*/*'},signal:AbortSignal.timeout(timeout)});if(!r.ok)throw new Error(`${url}: HTTP ${r.status}`);return await r.text()}catch(e){last=e;if(i<attempts)await sleep(800*i)}}throw last}

function publisherOf(z){
  for(const n of ['VkladatelDoRejstriku','vkladatelDoRejstriku','publikujiciSmluvniStrana','PublikujiciSmluvniStrana','vkladatel']){const b=block(z,n);if(b){const e=entityFrom(b);if(e.name||e.ico||e.box)return e}}
  for(const sb of blocks(z,'subjekt')){const e=entityFrom(sb);if(e.name||e.ico||e.box)return e}
  return null;
}
function contractBodyOf(z){const all=blocks(z,'smlouva');return all.find(b=>tag(b,'predmet')||tag(b,'datumUzavreni')||blocks(b,'smluvniStrana').length)||all[0]||z}
function partiesOf(z,publisherIco){
  const out=[],smlouva=contractBodyOf(z);
  for(const b of [...blocks(smlouva,'smluvniStrana'),...blocks(z,'smluvniStrana')]){const e=entityFrom(b);if((e.name||e.ico)&&normIco(e.ico)!==publisherIco)out.push(e)}
  if(!out.length){const sb=block(smlouva,'smluvniStrany')||block(smlouva,'SmluvniStrany');if(sb)for(const b of blocks(sb,'subjekt')){const e=entityFrom(b);if((e.name||e.ico)&&normIco(e.ico)!==publisherIco)out.push(e)}}
  const seen=new Set();return out.filter(e=>{const k=e.ico||String(e.name||'').toLowerCase();if(!k||seen.has(k))return false;seen.add(k);return true});
}
function parseRecord(z,targetByIco){
  const valid=(tag(z,'platnyZaznam')||'true').toLowerCase();if(['false','0','ne'].includes(valid))return null;
  const pub=publisherOf(z),pubIco=normIco(pub?.ico),target=targetByIco.get(pubIco);if(!target)return null;
  const smlouva=contractBodyOf(z),parties=partiesOf(z,pubIco),ident=block(z,'identifikator')||z;
  const idVerze=tag(ident,'idVerze')||tag(z,'idVerze'),idSmlouvy=tag(ident,'idSmlouvy')||tag(z,'idSmlouvy');
  let url=tag(z,'odkaz');if(!/\/smlouva\/\d+/.test(url)&&idVerze)url=`https://smlouvy.gov.cz/smlouva/${idVerze}`;
  const valueVat=val(tag(smlouva,'hodnotaVcetneDph')),valueNoVat=val(tag(smlouva,'hodnotaBezDph'));
  return {entityIco:pubIco,entityName:target.name,entityKind:target.kind,id:idVerze||idSmlouvy||url,idContract:idSmlouvy||'',url,subject:tag(smlouva,'predmet')||'Smlouva',published:iso(tag(z,'casZverejneni')||tag(z,'datumPublikace')),signed:iso(tag(smlouva,'datumUzavreni')),valueCzk:valueVat??valueNoVat,valueVatCzk:valueVat,valueNoVatCzk:valueNoVat,counterparties:parties,counterparty:parties.map(x=>x.name).filter(Boolean).join(', '),publisher:pub?.name||target.name,publisherIco:pubIco};
}
function stripEntityFields(c){const {entityIco,entityName,entityKind,...rest}=c;return rest}
function dedupe(items){const map=new Map();for(const c of items){const key=c.idContract||c.id,old=map.get(key);if(!old||(c.published||'')>(old.published||'')||Number(c.id)>Number(old.id))map.set(key,c)}return [...map.values()].sort((a,b)=>(b.published||'').localeCompare(a.published||''))}
function summarize(items){
  const partnerMap=new Map();for(const c of items)for(const p of c.counterparties||[]){const key=p.ico||String(p.name||'').toLowerCase();if(!key)continue;const x=partnerMap.get(key)||{name:p.name,ico:p.ico||'',contracts:0,knownValueCzk:0,valuedContracts:0};x.contracts++;if(c.valueCzk!=null&&(c.counterparties||[]).length===1){x.knownValueCzk+=c.valueCzk;x.valuedContracts++}partnerMap.set(key,x)}
  const partners=[...partnerMap.values()].sort((a,b)=>b.knownValueCzk-a.knownValueCzk||b.contracts-a.contracts||a.name.localeCompare(b.name,'cs'));const known=items.filter(x=>x.valueCzk!=null);const signed=items.map(x=>x.signed).filter(Boolean).sort();
  return {total:items.length,partners:partners.length,knownValueCzk:known.reduce((n,x)=>n+x.valueCzk,0),valuedContracts:known.length,dateFrom:signed[0]||'',dateTo:signed.at(-1)||'',partnerList:partners,contracts:items};
}
function czDate(d){return `${String(d.getUTCDate()).padStart(2,'0')}.${String(d.getUTCMonth()+1).padStart(2,'0')}.${d.getUTCFullYear()}`}

function detailLinks(html){
  const ids=new Set();
  for(const m of String(html).matchAll(/href=["']([^"']*\/smlouva\/(\d+)(?:\?[^"']*)?)["']/gi))ids.add(m[2]);
  return [...ids];
}
function xmlUrlFromDetail(html,id){
  const m=String(html).match(new RegExp(`href=["']([^"']*\\/smlouva\\/${id}\\/[^"']*registr_smluv_smlouva_${id}\\.xml[^"']*)["']`,'i'));
  if(!m)return '';
  return new URL(unesc(m[1]),'https://smlouvy.gov.cz').href;
}
async function pool(items,limit,fn){
  const out=new Array(items.length);let next=0;
  async function worker(){while(true){const i=next++;if(i>=items.length)return;out[i]=await fn(items[i],i)}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},worker));return out;
}

console.log('\nREGISTR SMLUV — LEHKÝ DENNÍ SYNC');
console.log('────────────────────────────────');
const [registry,data,entityData]=await Promise.all([readJson(ENTITY_REGISTRY),readJson(DATA),readJson(ENTITY_DATA)]);
const targets=registry?[registry.municipality,...(registry.entities||[])]:[];
const targetByIco=new Map(targets.map(x=>[normIco(x.ico),x]));
if(data?.meta?.historyComplete!==true||!Array.isArray(data?.contracts)||entityData?.entities?.length!==40||targets.length!==41)throw new Error('Denní Registr smluv odmítnut: chybí kompletní historický základ MČ Praha 8 + 40 subjektů.');

const to=new Date();const from=new Date(Date.now()-DAYS_BACK*86400000);
const fromText=czDate(from),toText=czDate(to);
console.log(`Kontroluji pouze živé vyhledávání ${fromText}–${toText} pro 41 publikujících subjektů.`);

const foundByIco=new Map();
await pool(targets,6,async target=>{
  const ico=normIco(target.ico);const u=new URL(SEARCH);
  u.searchParams.set('subject_idnum',ico);
  u.searchParams.set('publication_date[from]',fromText);
  u.searchParams.set('publication_date[to]',toText);
  u.searchParams.set('searchResultList-limit','100');
  const html=await fetchText(u.href,3,30000);const ids=detailLinks(html);
  if(ids.length>=100)throw new Error(`Registr smluv: ${target.name} má v okně ${DAYS_BACK} dní nejméně 100 výsledků; denní sync raději zastavuji, aby nic nechybělo.`);
  foundByIco.set(ico,ids);
});

const detailIds=[...new Set([...foundByIco.values()].flat())];
console.log(`Nalezeno ${detailIds.length} verzí smluv v posledních ${DAYS_BACK} dnech.`);
const records=(await pool(detailIds,6,async id=>{
  const detail=await fetchText(`https://smlouvy.gov.cz/smlouva/${id}`,3,30000);
  const xmlUrl=xmlUrlFromDetail(detail,id);
  if(!xmlUrl)throw new Error(`Registr smluv: u verze ${id} jsem nenašel odkaz na metadata XML.`);
  const xml=await fetchText(xmlUrl,3,30000);
  return parseRecord(xml,targetByIco);
})).filter(Boolean);

let p8=[...data.contracts];
const byEntity=new Map(entityData.entities.map(e=>[normIco(e.ico),[...(e.contracts||[])]]));
for(const rec of records){
  const clean=stripEntityFields(rec);
  if(rec.entityIco===P8_ICO)p8.push(clean);
  else byEntity.set(rec.entityIco,[...(byEntity.get(rec.entityIco)||[]),clean]);
}
p8=dedupe(p8);
const p8Sum=summarize(p8),now=new Date().toISOString();
const p8Payload={contracts:p8,partners:p8Sum.partnerList,meta:{...data.meta,total:p8.length,knownValueCzk:p8Sum.knownValueCzk,valuedContracts:p8Sum.valuedContracts,partners:p8Sum.partners,dateFrom:p8Sum.dateFrom,dateTo:p8Sum.dateTo,updated:now,historyComplete:true,method:'official-live-search-daily-overlap',validation:{status:'open-data-complete',note:`Historický základ zůstává z měsíčních open-data dumpů; denní přírůstky a nové verze se kontrolují přes živé vyhledávání Registru smluv v překryvném okně ${DAYS_BACK} dní.`}}};
const extra=registry.entities.map(e=>{const items=dedupe(byEntity.get(normIco(e.ico))||[]),sum=summarize(items);return {...e,...sum}});
const extraContracts=extra.reduce((n,x)=>n+x.total,0),extraKnown=extra.reduce((n,x)=>n+x.knownValueCzk,0);
const entityPayload={schema:2,updated:now,source:SEARCH,method:'official-live-search-daily-overlap',meta:{entities:40,organizations:registry.groups?.organizations?.length||37,companies:registry.groups?.companies?.length||3,totalContracts:extraContracts,knownValueCzk:extraKnown,validation:{status:'open-data-complete',p8Control:{current:p8.length},note:`Denní kontrola používá živé vyhledávání Registru smluv v okně ${DAYS_BACK} dní; historický základ se při denním běhu nestahuje.`}},entities:extra};
const qaPayload={updated:now,meta:entityPayload.meta,entities:extra.map(({contracts,partnerList,...x})=>x),p8:{total:p8.length}};
await atomicJson(DATA,p8Payload);await atomicJson(ENTITY_DATA,entityPayload);await atomicJson(ENTITY_QA,qaPayload);
console.log(`✅ HOTOVO: živá kontrola ${records.length} verzí · MČ ${p8.length.toLocaleString('cs-CZ')} smluv · 40 subjektů ${extraContracts.toLocaleString('cs-CZ')} smluv.`);
