import {readFile,writeFile,rename} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import puppeteer from 'puppeteer-core';

const root=resolve(import.meta.dirname,'..');
const DATA=resolve(root,'data','hlasovani.json');
const UA='Praha8-v-prehledech/3.0.19 (+public-data-indexer; public sources only)';

// Kontrolujeme celé normalizované názvy stran, ne podřetězce. Předchozí varianta
// s \bSTAN\b chybně označovala např. skutečné jméno „Martin Staněk“ jako stranu.
const partyKey=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const PARTY_NAMES=new Set([
  'Ceska piratska strana',
  'Piratska strana',
  'Pirati',
  'SPD a Trikolora pro Osmicku',
  'SPD',
  'Trikolora pro Osmicku',
  'Obcanska demokraticka strana',
  'ODS',
  'ANO 2011',
  'ANO',
  'TOP 09',
  'STAN',
  'KDU CSL',
  'CSSD',
  'SOCDEM',
  'KSCM',
  'Zeleni',
  'Praha sobe',
  '8ZIJE a PRAHA SOBE',
  'Osmicka zije',
  'Svobodni',
  'Starostove',
  'PATRIOTI',
  'Spolecne pro Prahu 8'
].map(partyKey));
const partyLike=s=>PARTY_NAMES.has(partyKey(s));
const badVoteName=s=>!s||partyLike(s)||!/\s/.test(String(s).trim());

function findChrome(){
  const candidates=[
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
  ].filter(Boolean);
  const hit=candidates.find(existsSync);
  if(!hit)throw new Error('Nenašel jsem Chrome/Chromium pro opravu hlasovacích dat.');
  return hit;
}

function deriveHtmlUrl(vote){
  const raw=String(vote?.url||'');
  if(/\.html(?:[?#]|$)/i.test(raw))return raw;
  const m=raw.match(/^(https?:\/\/[^?#]+?)\/hlasovani\/(\d{4})\.xml(?:[?#].*)?$/i);
  if(m)return `${m[1]}/export/html/${m[2]}.html`;
  const source=String(vote?.exportUrl||'');
  const n=Number(vote?.number||0);
  if(n&&/\/export\/html\/?(?:index\.html)?(?:[?#].*)?$/i.test(source))return source.replace(/index\.html(?:[?#].*)?$/i,'').replace(/\/?$/,'/')+String(n).padStart(4,'0')+'.html';
  return '';
}

async function parsePage(page,url){
  const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
  const status=response?.status()||0;
  if(status>=400)throw new Error(`${status} ${url}`);
  return page.evaluate(()=>{
    const VOTE_RE=/^(PRO|PROTI|ZDRŽEL(?:A)? SE|NEHLASOVAL(?:A)?|NEPŘÍTOMEN|NEPŘÍTOMNA)$/iu;
    const tidy=s=>String(s||'').replace(/\s+/g,' ').trim();
    const normalizeVote=v=>{
      const x=tidy(v).toUpperCase();
      if(x==='PRO'||x==='PROTI')return x;
      if(/^ZDRŽEL/.test(x))return 'ZDRŽEL SE';
      if(/^NEHLASOVAL/.test(x))return 'NEHLASOVAL';
      if(/^NEPŘÍTOM/.test(x))return 'NEPŘÍTOMEN';
      return x;
    };
    const text=document.body?.innerText||'';
    if(!/Výsledek hlasování/i.test(text))return {ok:false,reason:'stránka neobsahuje výsledek hlasování',rows:[]};
    const rows=[];
    for(const row of document.querySelectorAll('tr')){
      const cells=[...row.querySelectorAll('td,th')].map(x=>tidy(x.innerText));
      const vi=cells.findIndex(x=>VOTE_RE.test(x));
      if(vi<0)continue;
      const nonempty=[];
      for(let i=0;i<vi;i++)if(cells[i])nonempty.push({i,value:cells[i]});
      if(nonempty.length<2)continue;
      const party=nonempty.at(-1).value;
      const name=nonempty.at(-2).value;
      if(!name||/^\d+$/.test(name))continue;
      rows.push({name,vote:normalizeVote(cells[vi]),party});
    }
    const seen=new Set();
    return {ok:true,rows:rows.filter(x=>{const k=x.name.toLocaleLowerCase('cs-CZ');if(seen.has(k))return false;seen.add(k);return true})};
  });
}

const votes=JSON.parse(await readFile(DATA,'utf8'));
const badItems=votes.filter(item=>Array.isArray(item.votes)&&item.votes.some(v=>badVoteName(v?.name)));
console.log(`Hlasování s podezřelým jménem: ${badItems.length}/${votes.length}.`);

let repairedNames=0,normalizedLinks=0,failed=0;
const browser=badItems.length?await puppeteer.launch({headless:true,executablePath:findChrome(),args:['--no-sandbox','--disable-setuid-sandbox'],userAgent:UA}):null;
try{
  const page=browser?await browser.newPage():null;
  for(const item of votes){
    if(item.url&&item.sourceUrl!==item.url){
      if(item.sourceUrl&&!item.meetingUrl)item.meetingUrl=item.sourceUrl;
      item.sourceUrl=item.url;
      normalizedLinks++;
    }
    if(!Array.isArray(item.votes)||!item.votes.some(v=>badVoteName(v?.name)))continue;
    const htmlUrl=deriveHtmlUrl(item);
    if(!htmlUrl){failed++;continue}
    try{
      const parsed=await parsePage(page,htmlUrl);
      if(!parsed.ok)throw new Error(parsed.reason);
      if(parsed.rows.length<5)throw new Error(`nalezeno jen ${parsed.rows.length} jmen`);
      const stillBad=parsed.rows.filter(v=>badVoteName(v.name));
      if(stillBad.length)throw new Error(`po parsování zůstalo ${stillBad.length} jmen podobných názvu strany`);
      item.votes=parsed.rows;
      item.url=htmlUrl;
      item.sourceUrl=htmlUrl;
      repairedNames++;
      if(repairedNames%25===0)console.log(`   opraveno ${repairedNames}/${badItems.length} hlasování…`);
    }catch(e){
      failed++;
      console.log(`   ⚠ ${item.date||''} #${item.number||'?'}: ${e.message}`);
    }
  }
}finally{if(browser)await browser.close()}

const suspicious=votes.flatMap(v=>(v.votes||[]).filter(x=>badVoteName(x?.name)).map(x=>({date:v.date,number:v.number,name:x.name,url:v.url})));
if(suspicious.length){
  console.error(`❌ Po opravě zůstává ${suspicious.length} podezřelých jmen.`);
  for(const x of suspicious.slice(0,20))console.error(`   ${x.date||''} #${x.number||'?'} · ${x.name||'(prázdné)'} · ${x.url||''}`);
  throw new Error(`Hlasovací dataset stále obsahuje ${suspicious.length} chybných jmen.`);
}

const tmp=`${DATA}.tmp`;
await writeFile(tmp,JSON.stringify(votes,null,2));
await rename(tmp,DATA);
console.log(`✅ Hlasování: opravená jména u ${repairedNames} hlasování · sjednocené odkazy u ${normalizedLinks} záznamů · podezřelých jmen 0 · neúspěšných oprav ${failed}.`);
