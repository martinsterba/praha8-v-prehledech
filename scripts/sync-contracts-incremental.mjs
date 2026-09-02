import {readFile,writeFile,rename} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const DATA=resolve(root,'data','smlouvy.json');
const ENTITY_DATA=resolve(root,'data','smlouvy-subjekty.json');
const ENTITY_QA=resolve(root,'data','contracts-entities-qa.json');
const ENTITY_REGISTRY=resolve(root,'data','contract-entities.json');
const STATE=resolve(root,'data','contracts-sync-state.json');
const INDEX='https://data.smlouvy.gov.cz/index.xml';
const P8_ICO='00063797';
const UA='Praha8-v-prehledech/3.0.3 (+public-data-indexer; public sources only)';
const PLAN=process.argv.includes('--plan');
const INIT=process.argv.includes('--init-state');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const unesc=s=>String(s||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&apos;/g,"'").trim();
const values=(xml,name)=>[...String(xml||'').matchAll(new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${name}>`,'gi'))].map(m=>unesc(m[1].replace(/<[^>]+>/g,' ')).trim());
const tag=(xml,name)=>values(xml,name)[0]||'';
const block=(xml,name)=>{const m=String(xml||'').match(new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${name}>`,'i'));return m?m[1]:''};
const blocks=(xml,name)=>[...String(xml||'').matchAll(new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${name}>`,'gi'))].map(m=>m[1]);
const normIco=s=>{const d=String(s||'').replace(/\D/g,'');return d?d.padStart(8,'0'):''};
const val=s=>{const n=Number(String(s||'').replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)&&n>0?n:null};
const iso=s=>{const x=String(s||'').trim();if(!x)return '';const m=x.match(/^(\d{4}-\d{2}-\d{2})/);if(m)return m[1];const c=x.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);return c?`${c[3]}-${c[2].padStart(2,'0')}-${c[1].padStart(2,'0')}`:''};
const monthOf=x=>String(x||'').slice(0,7);
const entityFrom=b=>({name:tag(b,'nazev')||tag(b,'nazevSubjektu')||tag(b,'jmeno'),ico:normIco(tag(b,'ico')),box:tag(b,'datovaSchranka')||tag(b,'datovaSchrankaId')});
async function readJson(path){try{return JSON.parse(await readFile(path,'utf8'))}catch{return null}}
async function atomicJson(path,data){const tmp=`${path}.tmp`;await writeFile(tmp,JSON.stringify(data,null,2));await rename(tmp,path)}
async function fetchText(url,attempts=3,timeout=240000){let last;for(let i=1;i<=attempts;i++){try{const r=await fetch(url,{headers:{'user-agent':UA,'accept':'application/xml,text/xml,*/*'},signal:AbortSignal.timeout(timeout)});if(!r.ok)throw new Error(`${url}: HTTP ${r.status}`);return await r.text()}catch(e){last=e;if(i<attempts)await sleep(1500*i)}}throw last}

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
function parseIndex(index){
  const years=values(index,'rok'),months=values(index,'mesic'),hashes=values(index,'hashDumpu'),sizes=values(index,'velikostDumpu'),generated=values(index,'casGenerovani'),done=values(index,'dokoncenyMesic'),urls=values(index,'odkaz').filter(x=>/dump_\d{4}_\d{2}\.xml/i.test(x));
  if(!urls.length)throw new Error('Index Registru smluv neobsahuje měsíční dumpy.');
  return urls.map((url,i)=>{const m=url.match(/dump_(\d{4})_(\d{2})/);return {month:`${m?.[1]||years[i]||'?'}-${m?.[2]||String(months[i]||'').padStart(2,'0')}`,url,hash:hashes[i]||'',size:Number(sizes[i]||0),generated:generated[i]||'',complete:String(done[i]||'')==='1'}}).sort((a,b)=>a.month.localeCompare(b.month));
}

console.log('\nREGISTR SMLUV — SPOLEČNÝ INKREMENTÁLNÍ SYNC — v3.0.3');
console.log('────────────────────────────────────────────────────');
const [registry,data,entityData,state]=await Promise.all([readJson(ENTITY_REGISTRY),readJson(DATA),readJson(ENTITY_DATA),readJson(STATE)]);
const targets=registry?[registry.municipality,...(registry.entities||[])]:[];
const targetByIco=new Map(targets.map(x=>[normIco(x.ico),x]));
const baselineOk=data?.meta?.historyComplete===true&&Array.isArray(data.contracts)&&entityData?.entities?.length===40&&targets.length===41&&targetByIco.size===41;
console.log(`Historický základ: ${baselineOk?'✅ MČ Praha 8 + 40 subjektů':'❌ nekompletní'}.`);
console.log('Načítám malý index Registru smluv…');
const index=await fetchText(INDEX,3,60000),entries=parseIndex(index),open=entries.filter(x=>!x.complete);

if(INIT){
  if(!baselineOk)throw new Error('Nelze inicializovat stav: chybí kompletní historický základ MČ Praha 8 + 40 subjektů.');
  await atomicJson(STATE,{schema:2,updated:new Date().toISOString(),source:INDEX,scope:'municipality-plus-40-entities',dumps:Object.fromEntries(entries.map(x=>[x.month,{hash:x.hash,size:x.size,generated:x.generated,complete:x.complete,url:x.url}]))});
  console.log(`✅ Stav inicializován pro ${entries.length} měsíčních dumpů a všech 41 subjektů.`);process.exit(0);
}

const prev=state?.dumps||{};
const dumpChanged=(x,old)=>{
  if(!old)return true;
  if(x.hash)return x.hash!==String(old.hash||'');
  return x.size!==Number(old.size||0)||x.generated!==String(old.generated||'');
};
const stateChanged=entries.length!==Object.keys(prev).length||entries.some(x=>{
  const old=prev[x.month];
  return !old||x.hash!==String(old.hash||'')||x.size!==Number(old.size||0)||x.generated!==String(old.generated||'')||x.complete!==Boolean(old.complete)||x.url!==String(old.url||'');
});
const changed=entries.filter(x=>dumpChanged(x,prev[x.month]));
const totalSize=changed.reduce((n,x)=>n+(x.size||0),0);
console.log(`Index: ${entries.length} měsíců · otevřené/průběžné: ${open.map(x=>x.month).join(', ')||'žádný'}.`);
console.log(`Ke stažení: ${changed.length} skutečně změněných dumpů${totalSize?` · cca ${(totalSize/1024/1024/1024).toFixed(2)} GB XML`:''}.`);
if(PLAN){console.log(changed.length?`Měsíce: ${changed.map(x=>x.month).join(', ')}`:'Žádné skutečně změněné měsíční dumpy.');console.log(baselineOk?'✅ Historický základ je připravený.':'❌ Historický základ není kompletní.');process.exit(0)}
if(!baselineOk)throw new Error('Inkrementální sync odmítnut: chybí kompletní historický základ MČ Praha 8 + 40 subjektů.');
if(!state)throw new Error('Inkrementální sync odmítnut: chybí contracts-sync-state.json.');
if(!changed.length){
  if(stateChanged){
    const now=new Date().toISOString();
    const nextState={schema:2,updated:now,source:INDEX,scope:'municipality-plus-40-entities',dumps:Object.fromEntries(entries.map(x=>[x.month,{hash:x.hash,size:x.size,generated:x.generated,complete:x.complete,url:x.url}]))};
    await atomicJson(STATE,nextState);
    console.log('ℹ️ Metadata indexu se změnila; stav synchronizace byl aktualizován bez stahování dumpu.');
  }
  console.log('✅ Žádný nový ani obsahově změněný dump. MČ Praha 8 ani 40 subjektů nebylo třeba přepisovat.');
  process.exit(0);
}

let p8=[...data.contracts];
const byEntity=new Map(entityData.entities.map(e=>[normIco(e.ico),[...(e.contracts||[])]]));
for(const entry of changed){
  console.log(`Stahuji ${entry.month}${entry.complete?'':' (průběžný měsíc)'}…`);
  const xml=await fetchText(entry.url),monthByEntity=new Map(targets.map(x=>[normIco(x.ico),[]]));
  const re=/<(?:(?:[\w.-]+):)?zaznam\b[^>]*>([\s\S]*?)<\/(?:(?:[\w.-]+):)?zaznam>/gi;let x;
  while((x=re.exec(xml))){const item=parseRecord(x[1],targetByIco);if(item?.id)monthByEntity.get(item.entityIco)?.push(item)}
  const p8Month=dedupe(monthByEntity.get(P8_ICO)||[]).map(stripEntityFields);
  p8=p8.filter(c=>monthOf(c.published)!==entry.month);p8.push(...p8Month);
  let extraMonth=0;
  for(const e of registry.entities){const ico=normIco(e.ico),fresh=dedupe(monthByEntity.get(ico)||[]).map(stripEntityFields),old=byEntity.get(ico)||[];byEntity.set(ico,[...old.filter(c=>monthOf(c.published)!==entry.month),...fresh]);extraMonth+=fresh.length}
  console.log(`  ${entry.month}: MČ ${p8Month.length.toLocaleString('cs-CZ')} · dalších 40 subjektů ${extraMonth.toLocaleString('cs-CZ')} smluv.`);
}

p8=dedupe(p8);const p8Sum=summarize(p8);const now=new Date().toISOString();
const p8Payload={contracts:p8,partners:p8Sum.partnerList,meta:{...data.meta,total:p8.length,knownValueCzk:p8Sum.knownValueCzk,valuedContracts:p8Sum.valuedContracts,partners:p8Sum.partners,dateFrom:p8Sum.dateFrom,dateTo:p8Sum.dateTo,updated:now,historyComplete:true,method:'open-data-monthly-dumps-incremental-all-entities-by-index-hash',validation:{status:'open-data-complete',note:'Historický základ MČ Praha 8 i 40 navázaných subjektů se aktualizuje společně pouze z měsíčních dumpů, jejichž obsah se podle oficiálního indexu skutečně změnil.'}}};

const extra=registry.entities.map(e=>{const items=dedupe(byEntity.get(normIco(e.ico))||[]),sum=summarize(items);return {...e,...sum}});
const extraContracts=extra.reduce((n,x)=>n+x.total,0),extraKnown=extra.reduce((n,x)=>n+x.knownValueCzk,0);
const entityPayload={schema:2,updated:now,source:INDEX,method:'open-data-monthly-dumps-incremental-all-entities-by-index-hash',meta:{dumps:entries.length,entities:40,organizations:registry.groups?.organizations?.length||37,companies:registry.groups?.companies?.length||3,totalContracts:extraContracts,knownValueCzk:extraKnown,validation:{status:'open-data-complete',p8Control:{current:p8.length},note:'MČ Praha 8 a všech 40 sledovaných organizací/firem se aktualizují z téhož skutečně změněného dumpu jedním stažením.'}},entities:extra};
const qaPayload={updated:now,meta:entityPayload.meta,entities:extra.map(({contracts,partnerList,...x})=>x),p8:{total:p8.length}};
const nextState={schema:2,updated:now,source:INDEX,scope:'municipality-plus-40-entities',dumps:Object.fromEntries(entries.map(x=>[x.month,{hash:x.hash,size:x.size,generated:x.generated,complete:x.complete,url:x.url}]))};

await atomicJson(DATA,p8Payload);await atomicJson(ENTITY_DATA,entityPayload);await atomicJson(ENTITY_QA,qaPayload);await atomicJson(STATE,nextState);
console.log(`✅ HOTOVO: MČ ${p8.length.toLocaleString('cs-CZ')} smluv · 40 subjektů ${extraContracts.toLocaleString('cs-CZ')} smluv · aktualizováno ${changed.length} dumpů.`);
