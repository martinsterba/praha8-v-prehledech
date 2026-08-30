import {readFile,writeFile,rename} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const DATA=resolve(root,'data','hlasovani.json');
const UA='Praha8-v-prehledech/3.0.16 (+public-data-indexer; public sources only)';

const PARTY_RE=/(?:^|\b)(?:Česká pirátská strana|Piráti|SPD|Trikolora(?: pro Osmičku)?|ODS|ANO(?: 2011)?|TOP ?09|STAN|KDU-ČSL|ČSSD|SOCDEM|KSČM|Zelení|Praha sobě|Osmička žije|Svobodní|Starostové|koalice|politická strana|hnutí)(?:\b|$)/iu;
const VOTE_RE=/^(PRO|PROTI|ZDRŽEL(?:A)? SE|NEHLASOVAL(?:A)?|NEPŘÍTOMEN|NEPŘÍTOMNA)$/iu;
const NAME_RE=/^[\p{L}][\p{L}.'’\-]*(?:\s+[\p{L}][\p{L}.'’\-]*){1,5}(?:,?\s+(?:DiS\.?|MBA|MPA|Ph\.D\.|CSc\.|DBA|LL\.M\.))?$/u;

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
  if(!m)return '';
  return `${m[1]}/export/html/${m[2]}.html`;
}

function parseRows(html){
  const rows=[];
  for(const rm of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
    const cells=[...rm[1].matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map(m=>clean(m[1])).filter(Boolean);
    const vi=cells.findIndex(x=>VOTE_RE.test(x));
    if(vi<0)continue;
    const before=cells.slice(0,vi).map(normalizeName).filter(Boolean);
    const candidates=before.filter(x=>NAME_RE.test(x)&&!partyLike(x)&&!/^(?:č\.?|poř\.?|pořadí|jméno|zastupitel)$/iu.test(x));
    const name=candidates[0]||'';
    if(!name)continue;
    const party=before.find(x=>x!==name&&partyLike(x))||'';
    rows.push({name,vote:normalizeVote(cells[vi]),...(party?{party}:{})});
  }
  const seen=new Set();
  return rows.filter(x=>{const k=x.name.toLocaleLowerCase('cs-CZ');if(seen.has(k))return false;seen.add(k);return true});
}

const votes=JSON.parse(await readFile(DATA,'utf8'));
let repairedNames=0,normalizedLinks=0,failed=0;

for(let i=0;i<votes.length;i++){
  const item=votes[i];

  // V detailu hlasování má zdroj vždy mířit přímo na konkrétní jmenné hlasování.
  // Původní stránku zasedání si ponecháme zvlášť pro dohledatelnost.
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

const tmp=`${DATA}.tmp`;
await writeFile(tmp,JSON.stringify(votes,null,2));
await rename(tmp,DATA);
console.log(`✅ Hlasování: opravená jména u ${repairedNames} hlasování · sjednocené odkazy u ${normalizedLinks} záznamů${failed?` · ${failed} položek se nepodařilo automaticky opravit`:''}.`);
