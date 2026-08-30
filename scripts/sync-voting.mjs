import {readFile, writeFile, rename} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import puppeteer from 'puppeteer-core';

const root=resolve(import.meta.dirname,'..');
const DATA=resolve(root,'data','hlasovani.json');
const SOURCES=resolve(root,'data','hlasovani-zdroje.json');
const PAGE='https://www.praha8.cz/Prehledy-hlasovani.html';
const UA='Praha8-v-prehledech/3.0.13 (+public-data-indexer; public sources only)';
const BOOTSTRAP=process.argv.includes('--bootstrap');
const PLAN=process.argv.includes('--plan');
const FIRST=process.argv.includes('--first');

const clean=s=>String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/\s+/g,' ').trim();
const absolute=(href,base)=>new URL(href,base).href;
const isoDate=s=>{const m=String(s||'').match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);return m?`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:''};
async function fetchText(url,accept='text/html,*/*'){const r=await fetch(url,{headers:{'user-agent':UA,accept},signal:AbortSignal.timeout(60000)});if(!r.ok)throw new Error(`${r.status} ${url}`);return r.text()}
async function readJson(path,fallback){try{return JSON.parse(await readFile(path,'utf8'))}catch{return fallback}}
async function atomicJson(path,data){const tmp=`${path}.tmp`;await writeFile(tmp,JSON.stringify(data,null,2));await rename(tmp,path)}

function findChrome(){
  const candidates=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge','/Applications/Chromium.app/Contents/MacOS/Chromium',process.env.PUPPETEER_EXECUTABLE_PATH].filter(Boolean);
  const hit=candidates.find(existsSync);
  if(!hit)throw new Error('Nenašel jsem Chrome/Edge. Nainstalujte Chrome nebo nastavte PUPPETEER_EXECUTABLE_PATH.');
  return hit;
}

function attrs(tag=''){
  const out={};
  for(const m of tag.matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/gs))out[m[1]]=m[3];
  return out;
}
function num(v){const n=Number(v);return Number.isFinite(n)?n:null}
function normalizeXmlVote(v=''){
  const x=String(v).toUpperCase().trim();
  if(['AYE','YES','PRO'].includes(x))return 'PRO';
  if(['NO','PROTI'].includes(x))return 'PROTI';
  if(['ABSTAINED','ABSTAIN','ZDRŽEL SE','ZDRZEL SE'].includes(x))return 'ZDRŽEL SE';
  if(['NOT_VOTING','NOT VOTING','NEHLASOVAL'].includes(x))return 'NEHLASOVAL';
  if(['MISSING','ABSENT','NEPŘÍTOMEN','NEPRITOMEN'].includes(x))return 'NEPŘÍTOMEN';
  return x||'NEZNÁMÝ';
}

function exportCandidates(date='',discovered=''){
  const out=[];
  if(discovered)out.push(discovered);
  const m=String(date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(m){
    const [,y,mo,da]=m;
    const modern=`${y}${mo}${da}`;
    const legacy=`${y}${Number(mo)}${Number(da)}`;
    for(const x of [modern,legacy]){
      out.push(`https://praha8.cz/podklady_mc/ZMC${x}audiohlasovani/export/html/`);
      out.push(`https://praha8.cz/podklady_mc/ZMC${x}audiohlasovani/Export/html/`);
    }
  }
  return [...new Set(out.filter(Boolean))];
}

function discoverSources(html){
  const out=[];
  for(const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
    const title=clean(m[2]);
    if(!/Přehled hlasování zastupitelstva/i.test(title))continue;
    const date=isoDate(title); if(!date)continue;
    out.push({date,title,url:absolute(m[1],PAGE)});
  }
  return [...new Map(out.map(x=>[x.date,x])).values()].sort((a,b)=>b.date.localeCompare(a.date));
}

function normalizeExportBase(url=''){
  const x=String(url||'').replace(/&amp;/g,'&');
  const m=x.match(/^(https?:\/\/[^\s"'<>]+?\/podklady_mc\/[^\s"'<>]+?\/(?:export|Export)\/html\/)(?:index\.html)?(?:[?#].*)?$/i);
  return m?.[1]||'';
}
function normalizeXmlIndex(url=''){
  const x=String(url||'').replace(/\\/g,'/').replace(/&amp;/g,'&');
  const m=x.match(/^(https?:\/\/[^\s"'<>]+?\/podklady_mc\/[^\s"'<>]+?\/hlasovani\/index\.xml)(?:[?#].*)?$/i);
  return m?.[1]||'';
}

async function discoverSourceEndpoints(page,source){
  await page.goto(source.url,{waitUntil:'domcontentloaded',timeout:30000});
  await new Promise(r=>setTimeout(r,250));
  const vals=[...page.frames().map(f=>f.url())];
  vals.push(...await page.evaluate(()=>{
    const out=[];
    for(const el of document.querySelectorAll('a,iframe,frame,object,embed,form'))for(const a of ['href','src','data','action']){const v=el.getAttribute(a);if(v)out.push(v)}
    const html=document.documentElement.innerHTML||'';
    for(const m of html.matchAll(/(?:https?:\/\/[^\s"'<>]+|\/[^\s"'<>]+)?podklady_mc\/[^\s"'<>]+?\/(?:hlasovani\/index\.xml|(?:export|Export)\/html\/(?:index\.html)?)/gi))out.push(m[0]);
    return out;
  }));
  let xmlIndex='',exportBase='';
  for(const raw of vals){
    try{
      const u=new URL(String(raw).replace(/\\/g,'/'),source.url).href;
      if(!xmlIndex)xmlIndex=normalizeXmlIndex(u);
      if(!exportBase)exportBase=normalizeExportBase(u);
    }catch{}
  }
  return {xmlIndex,exportBase};
}

async function baseWorks(page,base){
  try{
    const r=await page.goto(`${base}0001.html`,{waitUntil:'domcontentloaded',timeout:30000});
    if((r?.status()||0)>=400)return false;
    return await page.evaluate(()=>/Výsledek hlasování/i.test(document.body?.innerText||''));
  }catch{return false}
}

async function findExportBase(votePage,source,discovered=''){
  for(const base of exportCandidates(source.date,discovered))if(await baseWorks(votePage,base))return base;
  return '';
}

async function parseHtmlVote(page,url,source,exportBase,fallbackNumber){
  const data=await page.evaluate((fallbackNumber)=>{
    const text=(document.body?.innerText||'').replace(/\r/g,'');
    const lines=text.split('\n').map(x=>x.trim()).filter(Boolean);
    const titleLine=lines.find(x=>/Výsledek hlasování/i.test(x))||'';
    if(!titleLine)return null;
    let number=fallbackNumber,item='',title='';
    let head=titleLine.match(/Výsledek hlasování č\.\s*(\d+)\s*-\s*bod č\.\s*([^\s]+)\s*-\s*(.*)/i);
    if(head){number=Number(head[1]);item=head[2]||'';title=head[3]||''}
    else {head=titleLine.match(/Výsledek hlasování(?:\s+\d{1,2}\.\d{1,2}\.\d{4})?\s*-?\s*bod č\.\s*([^\s]+)\s*-\s*(.*)/i);if(head){item=head[1]||'';title=head[2]||''}}
    const total=label=>{const m=text.match(new RegExp(label+'\\s*:\\s*(\\d+)','i'));return m?Number(m[1]):null};
    const votes=[];
    for(const row of document.querySelectorAll('tr')){
      const cells=[...row.querySelectorAll('td,th')].map(x=>x.innerText.trim()).filter(Boolean);
      const vi=cells.findIndex(x=>/^(PRO|PROTI|ZDRŽEL(?:A)? SE|NEHLASOVAL(?:A)?|NEPŘÍTOMEN|NEPŘÍTOMNA)$/i.test(x));
      if(vi<0)continue;
      const name=[...cells.slice(0,vi)].reverse().find(x=>/^[\p{L}.]+(?:\s+[\p{L}.]+)+$/u.test(x) && !/^\d+$/.test(x));
      if(name)votes.push({name,vote:cells[vi]});
    }
    return {titleLine,number,item,title,present:total('PŘÍTOMNÝCH'),for:total('PRO'),against:total('PROTI'),abstained:total('ZDRŽELO SE'),notVoting:total('NEHLASOVALO'),absent:total('NEPŘÍTOMNÝCH'),votes};
  },fallbackNumber);
  if(!data?.number)return null;
  const complete=[data.present,data.for,data.against,data.abstained,data.notVoting,data.absent].every(Number.isFinite);
  if(!complete)throw new Error(`Hlasování č. ${data.number}: chybí souhrnné počty.`);
  return {...data,date:source.date,url,sourceUrl:source.url,exportUrl:`${exportBase}index.html`};
}

async function crawlHtml(votePage,source,discovered=''){
  const exportBase=await findExportBase(votePage,source,discovered);
  if(!exportBase)throw new Error('nenalezen funkční HTML hlasovací export.');
  console.log(`      zdroj HTML: ${exportBase}`);
  const items=[];let misses=0;const MAX=250,STOP=5;
  for(let n=1;n<=MAX;n++){
    const url=`${exportBase}${String(n).padStart(4,'0')}.html`;
    let response;try{response=await votePage.goto(url,{waitUntil:'domcontentloaded',timeout:30000})}catch(e){throw new Error(`Hlasování ${n}: ${e.message}`)}
    const status=response?.status()||0;
    if(status===404){misses++;if(items.length&&misses>=STOP)break;if(!items.length&&n>=STOP)break;continue}
    if(status>=400)throw new Error(`${status} ${url}`);
    const x=await parseHtmlVote(votePage,url,source,exportBase,n);
    if(!x){misses++;if(items.length&&misses>=STOP)break;if(!items.length&&n>=STOP)break;continue}
    misses=0;items.push(x);
    console.log(`      #${x.number}${x.item?` · bod ${x.item}`:''} · PRO ${x.for} · PROTI ${x.against} · ZDRŽEL SE ${x.abstained} · NEHLASOVAL ${x.notVoting} · přítomných ${x.present} · jmenovitých ${x.votes.length}`);
  }
  return {items:[...new Map(items.map(x=>[`${x.date}|${x.number}`,x])).values()],sourceMeta:{mode:'html',exportBase}};
}

async function crawlXml(indexPage,source,xmlIndex){
  console.log(`      zdroj XML: ${xmlIndex}`);
  const r=await indexPage.goto(xmlIndex,{waitUntil:'domcontentloaded',timeout:30000});
  if((r?.status()||0)>=400)throw new Error(`${r?.status()} ${xmlIndex}`);
  await new Promise(r=>setTimeout(r,300));
  const links=await indexPage.evaluate(()=>[...document.querySelectorAll('a[href]')].map(a=>({href:a.href,text:(a.innerText||a.textContent||'').replace(/\s+/g,' ').trim()})).filter(x=>/\/\d{4}\.xml(?:$|[?#])/i.test(x.href)));
  const unique=[...new Map(links.map(x=>[x.href,x])).values()];
  if(!unique.length)throw new Error('XML index neobsahuje odkazy na jednotlivá hlasování.');
  const items=[];
  for(const link of unique){
    const file=link.href.match(/\/(\d{4})\.xml(?:$|[?#])/i)?.[1];
    const number=Number(file||0);if(!number)continue;
    const xml=await fetchText(link.href,'application/xml,text/xml,text/plain,*/*');
    const rootTag=xml.match(/<VotingResult\b[^>]*>/i)?.[0]||'';
    const rootAttrs=attrs(rootTag);
    const topicTag=xml.match(/<Topic\b[^>]*>/i)?.[0]||'';
    const topicAttrs=attrs(topicTag);
    const comment=(xml.match(/<Comment>([\s\S]*?)<\/Comment>/i)?.[1]||'').replace(/<!\[CDATA\[|\]\]>/g,'').trim();
    const votes=[];
    for(const m of xml.matchAll(/<Deputy\b[^>]*\/>/gi)){
      const a=attrs(m[0]);
      const name=[a.first_name,a.name].filter(Boolean).join(' ').trim();
      if(name)votes.push({name,vote:normalizeXmlVote(a.vote),party:a.party||''});
    }
    const x={
      titleLine:link.text||comment||`Hlasování č. ${number}`,
      number,
      item:topicAttrs.number||'',
      title:link.text||comment||rootAttrs.category_label||'',
      present:num(rootAttrs.present),
      for:num(rootAttrs.aye),
      against:num(rootAttrs.no),
      abstained:num(rootAttrs.abstained),
      notVoting:num(rootAttrs.not_voting),
      absent:num(rootAttrs.missing),
      votes,
      date:source.date,
      url:link.href,
      sourceUrl:source.url,
      exportUrl:xmlIndex
    };
    const complete=[x.present,x.for,x.against,x.abstained,x.notVoting,x.absent].every(Number.isFinite);
    if(!complete)throw new Error(`XML hlasování č. ${number}: chybí souhrnné počty.`);
    items.push(x);
    console.log(`      #${x.number}${x.item?` · bod ${x.item}`:''} · PRO ${x.for} · PROTI ${x.against} · ZDRŽEL SE ${x.abstained} · NEHLASOVAL ${x.notVoting} · přítomných ${x.present} · jmenovitých ${x.votes.length}`);
  }
  return {items:[...new Map(items.map(x=>[`${x.date}|${x.number}`,x])).values()],sourceMeta:{mode:'xml',xmlIndex}};
}

console.log(`\nHLASOVÁNÍ ZMČ PRAHA 8 — ${BOOTSTRAP?'KOMPLETNÍ BOOTSTRAP':'INKREMENTÁLNÍ SYNC'} — v3.0.13`);
console.log('─────────────────────────────────────────────────────────');
let sources=discoverSources(await fetchText(PAGE));
if(FIRST)sources=sources.slice(0,1);
if(!sources.length)throw new Error('Na stránce Prahy 8 nebyly nalezeny žádné přehledy hlasování.');
const old=await readJson(DATA,[]),oldSources=await readJson(SOURCES,[]);
const known=new Set(oldSources.map(x=>x.date||x.url));
const todo=BOOTSTRAP?sources:sources.filter(x=>!known.has(x.date)&&!known.has(x.url));
console.log(`Zdrojová stránka: ${sources.length} zasedání Zastupitelstva · ke zpracování: ${todo.length}.`);
if(PLAN){console.log(todo.length?todo.map(x=>`  ${x.date} · ${x.url}`).join('\n'):'✅ Žádné nové zasedání.');process.exit(0)}
if(!BOOTSTRAP&&!old.length)throw new Error('Chybí historický základ data/hlasovani.json. Nejdřív spusťte npm run sync:voting:bootstrap.');
if(!todo.length){console.log('✅ Žádné nové zasedání. Existující hlasování zůstala beze změny.');process.exit(0)}

const browser=await puppeteer.launch({headless:true,executablePath:findChrome(),args:['--no-sandbox','--disable-setuid-sandbox'],userAgent:UA});
let fresh=[],processed=[];
try{
  const discoveryPage=await browser.newPage();
  const votePage=await browser.newPage();
  const indexPage=await browser.newPage();
  for(let i=0;i<todo.length;i++){
    const s=todo[i];console.log(`   ${i+1}/${todo.length} ${s.date}`);
    try{
      const endpoints=await discoverSourceEndpoints(discoveryPage,s);
      let result;
      if(endpoints.xmlIndex)result=await crawlXml(indexPage,s,endpoints.xmlIndex);
      else result=await crawlHtml(votePage,s,endpoints.exportBase);
      if(!result.items.length)throw new Error('nenalezeno žádné hlasování.');
      fresh.push(...result.items);processed.push({...s,...result.sourceMeta});
      console.log(`      ✅ ${result.items.length} hlasování · ${result.items.length} výsledků.`);
    }catch(e){console.log(`      ⚠ zasedání nebylo uloženo: ${e.message}`)}
  }
}finally{await browser.close()}

if(FIRST)process.exit(fresh.length?0:1);
if(!fresh.length)throw new Error('Z žádného zasedání se nepodařilo načíst hlasování. Existující dataset nebyl přepsán.');
const merged=BOOTSTRAP?fresh:[...old,...fresh];
const unique=[...new Map(merged.map(x=>[`${x.date}|${x.number}`,x])).values()].sort((a,b)=>b.date.localeCompare(a.date)||a.number-b.number);
const sourceBase=BOOTSTRAP?processed:[...oldSources,...processed];
const sourceUnique=[...new Map(sourceBase.map(x=>[x.date||x.url,x])).values()].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
await atomicJson(DATA,unique);await atomicJson(SOURCES,sourceUnique);
console.log(`✅ HOTOVO: ${unique.length.toLocaleString('cs-CZ')} hlasování z ${sourceUnique.length}/${sources.length} úspěšně zpracovaných zasedání Zastupitelstva${BOOTSTRAP?' (historický základ)':''}.`);
if(sourceUnique.length!==sources.length)console.log(`⚠ ${sources.length-sourceUnique.length} zasedání zůstává ke zpracování; nebudou považována za synchronizovaná.`);
