import {readFile,writeFile,rename} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const DATA=resolve(root,'data','hlasovani.json');
const UA='Praha8-v-prehledech/3.0.17 (+public-data-indexer; public sources only)';

const PARTY_RE=/(?:^|\b)(?:Česká pirátská strana|Piráti|SPD|Trikolora(?: pro Osmičku)?|ODS|ANO(?: 2011)?|TOP ?09|STAN|KDU-ČSL|ČSSD|SOCDEM|KSČM|Zelení|Praha sobě|Osmička žije|8ŽIJE|Svobodní|Starostové|PATRIOTI|Společně pro Prahu|politická strana|politické hnutí)(?:\b|$)/iu;
const VOTE_RE=/^(PRO|PROTI|ZDRŽEL(?:A)? SE|NEHLASOVAL(?:A)?|NEPŘÍTOMEN|NEPŘÍTOMNA)$/iu;
const NAME_RE=/^[\p{L}][\p{L}.'’\-]*(?:\s+[\p{L}][\p{L}.'’\-]*){1,7}(?:,?\s+(?:DiS\.?|MBA|MPA|Ph\.D\.|CSc\.|DBA|LL\.M\.))?$/u;

const clean=s=>String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/\s+/g,' ').trim();
const normalizeVote=v=>{
  const x=String(v||'').toUpperCase().trim();
  if(x==='PRO')return 'PRO';
  if(x==='PROTI')return 'PROTI';
  if(/^ZDRŽEL/.test(x))return 'ZDRŽEL SE';
  if(/^NEHLASOVAL/.test(x))return 'NEHLASOVAL';
  if(/^NEPŘÍTOM/.test(x))return 'NEPŘÍTOMEN';
  return x;
};
const normalizeName=s=>String(s||'').replace(/\s+/g,' ').replace(/\s+,/g,',').trim();
const partyLike=s=>PARTY_RE.test(String(s||'').trim());
const badVoteName=s=>!s||partyLike(s)||!/\s/.test(String(s).trim());

async function fetchText(url){
  const r=await fetch(url,{headers:{'user-agent':UA,accept:'text/html,*/*'},signal:AbortSignal.timeout(45000)});
  if(!r.ok)throw new Error(`${r.status} ${url}`);
  return r.text();
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

function parseRows(html){
  const rows=[];
  for(const rm of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
    const cells=[...rm[1].matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map(m=>clean(m[1])).filter(Boolean);
    const vi=cells.findIndex(x=>VOTE_RE.test(x));
    if(vi<0)continue;

    // Oficiální export má sloupce … | Titul Jméno Příjmení | Strana | Hlasoval(a).
    // Předchozí parser hledal první text podobný jménu a u víceslovných názvů stran
    // tak zaměňoval např. „Česká pirátská strana“ za zastupitele.
    const party=vi>=1?normalizeName(cells[vi-1]):'';
    let name=vi>=2?normalizeName(cells[vi-2]):'';

    // U starších variant tabulky může být mezi jménem a stranou prázdný či pomocný sloupec.
    // Fallback proto hledá pouze vlevo OD sloupce strany, nikdy v něm.
    if(!NAME_RE.test(name)||partyLike(name)||/^\d+$/.test(name)){
      const left=cells.slice(0,Math.max(0,vi-1)).map(normalizeName).filter(Boolean);
      name=[...left].reverse().find(x=>NAME_RE.test(x)&&!partyLike(x)&&!/^\d+$/.test(x))||'';
    }
    if(!name)continue;
    rows.push({name,vote:normalizeVote(cells[vi]),...(party&&party!==name?{party}:{})});
  }
  const seen=new Set();
  return rows.filter(x=>{const k=x.name.toLocaleLowerCase('cs-CZ');if(seen.has(k))return false;seen.add(k);return true});
}

const votes=JSON.parse(await readFile(DATA,'utf8'));
let repairedNames=0,normalizedLinks=0,failed=0;

for(let i=0;i<votes.length;i++){
  const item=votes[i];
  if(item.url&&item.sourceUrl!==item.url){
    if(item.sourceUrl&&!item.meetingUrl)item.meetingUrl=item.sourceUrl;
    item.sourceUrl=item.url;
    normalizedLinks++;
  }

  const hasBadNames=Array.isArray(item.votes)&&item.votes.some(v=>badVoteName(v?.name));
  if(!hasBadNames)continue;

  const htmlUrl=deriveHtmlUrl(item);
  if(!htmlUrl){failed++;continue}
  try{
    const html=await fetchText(htmlUrl);
    if(!/Výsledek hlasování/i.test(clean(html)))throw new Error('stránka neobsahuje výsledek hlasování');
    const parsed=parseRows(html);
    if(parsed.length<5)throw new Error(`nalezeno jen ${parsed.length} jmen`);
    if(parsed.some(v=>badVoteName(v.name)))throw new Error('po parsování zůstalo jméno podobné názvu strany');
    item.votes=parsed;
    item.url=htmlUrl;
    item.sourceUrl=htmlUrl;
    repairedNames++;
    if(repairedNames%20===0)console.log(`   opraveno ${repairedNames} hlasování…`);
  }catch(e){
    failed++;
    console.log(`   ⚠ ${item.date||''} #${item.number||'?'}: ${e.message}`);
  }
}

const suspicious=votes.flatMap(v=>(v.votes||[]).filter(x=>badVoteName(x?.name)).map(x=>({date:v.date,number:v.number,name:x.name,url:v.url})));
if(suspicious.length){
  console.error(`❌ Po opravě zůstává ${suspicious.length} podezřelých jmen.`);
  for(const x of suspicious.slice(0,20))console.error(`   ${x.date||''} #${x.number||'?'} · ${x.name||'(prázdné)'} · ${x.url||''}`);
  throw new Error(`Hlasovací dataset stále obsahuje ${suspicious.length} chybných jmen.`);
}

const tmp=`${DATA}.tmp`;
await writeFile(tmp,JSON.stringify(votes,null,2));
await rename(tmp,DATA);
console.log(`✅ Hlasování: opravená jména u ${repairedNames} hlasování · sjednocené odkazy u ${normalizedLinks} záznamů · podezřelých jmen 0${failed?` · ${failed} neblokujících pokusů selhalo`:''}.`);
