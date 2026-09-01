import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const bodiesPath=resolve(root,'data','organy.json');
const peoplePath=resolve(root,'data','lide.json');
const statusPath=resolve(root,'data','source-status.json');

const TARGETS=[
  {
    name:'Komise pro obecní byty',
    url:'https://m.praha8.cz/Komise-pro-obecni-byty.html',
    materialsUrl:'https://www.praha8.cz/materialy-z-jednani-komise-pro-obecni-byty.html'
  },
  {
    name:'Komise pro sport, grantovou politiku',
    url:'https://m.praha8.cz/Komise-pro-sport-grantovou-politiku.html',
    materialsUrl:'https://www.praha8.cz/materialy-z-jednani-komise-pro-sport-grantovou-politiku.html'
  }
];

const readJson=async(path,fallback)=>{try{return JSON.parse(await readFile(path,'utf8'))}catch{return fallback}};
const strip=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const personKey=name=>{
  const drop=new Set(['mgr','bc','ing','phdr','judr','rndr','mvdr','doc','prof','phd','mba','mpa','ma','dis','csc','dba','bca','et']);
  return strip(name).split(/\s+/).filter(Boolean).filter(x=>!drop.has(x)&&x.length>1).slice(0,2).sort().join(' ');
};
const decode=s=>String(s||'')
  .replace(/&nbsp;|&#160;/gi,' ')
  .replace(/&amp;/gi,'&')
  .replace(/&quot;/gi,'"')
  .replace(/&#39;|&apos;/gi,"'")
  .replace(/&ndash;|&#8211;/gi,'–')
  .replace(/&mdash;|&#8212;/gi,'—')
  .replace(/&aacute;/gi,'á').replace(/&Aacute;/g,'Á')
  .replace(/&eacute;/gi,'é').replace(/&Eacute;/g,'É')
  .replace(/&iacute;/gi,'í').replace(/&Iacute;/g,'Í')
  .replace(/&oacute;/gi,'ó').replace(/&Oacute;/g,'Ó')
  .replace(/&uacute;/gi,'ú').replace(/&Uacute;/g,'Ú')
  .replace(/&yacute;/gi,'ý').replace(/&Yacute;/g,'Ý')
  .replace(/&ccaron;/gi,'č').replace(/&Ccaron;/g,'Č')
  .replace(/&scaron;/gi,'š').replace(/&Scaron;/g,'Š')
  .replace(/&zcaron;/gi,'ž').replace(/&Zcaron;/g,'Ž')
  .replace(/&rcaron;/gi,'ř').replace(/&Rcaron;/g,'Ř')
  .replace(/&ecaron;/gi,'ě').replace(/&Ecaron;/g,'Ě')
  .replace(/&uring;/gi,'ů').replace(/&Uring;/g,'Ů')
  .replace(/&dcaron;/gi,'ď').replace(/&Dcaron;/g,'Ď')
  .replace(/&tcaron;/gi,'ť').replace(/&Tcaron;/g,'Ť')
  .replace(/&ncaron;/gi,'ň').replace(/&Ncaron;/g,'Ň');

function htmlLines(html){
  return decode(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi,' ')
    .replace(/<\/?(?:li|p|h1|h2|h3|h4|h5|h6|div|section|article|br)\b[^>]*>/gi,'\n')
    .replace(/<[^>]+>/g,' ')
    .split(/\n+/)
    .map(x=>x.replace(/\s+/g,' ').trim())
    .filter(Boolean);
}

function parseCommission(lines,name,annotate){
  const start=lines.findIndex(x=>strip(x)===strip(name));
  if(start<0)throw new Error(`Nenalezen nadpis „${name}“`);
  const part=lines.slice(start+1);
  const out={chair:'',members:[],citizens:[],secretary:''};
  let mode='';
  for(const line of part){
    if(/^Související odkazy/i.test(line)||/^Mohlo by vás/i.test(line)||/^Aktualizováno:/i.test(line))break;
    if(/^Předsed(?:a|kyně)$/i.test(line)){mode='chair';continue}
    if(/^Členové z řad zastupitelů$/i.test(line)){mode='members';continue}
    if(/^Členové z řad občanů$/i.test(line)){mode='citizens';continue}
    if(/^Tajemní(?:k|ce)$/i.test(line)){mode='secretary';continue}
    if(!mode)continue;
    if(/^(Členové|Předsed|Tajemní)/i.test(line))continue;
    if(line.length<3||line.length>100)continue;
    if(mode==='chair'&&!out.chair){out.chair=line;mode='';continue}
    if(mode==='secretary'&&!out.secretary){out.secretary=line;mode='';continue}
    if(mode==='members')out.members.push(line);
    if(mode==='citizens')out.citizens.push(line);
  }
  return {
    chair:out.chair?annotate(out.chair):null,
    members:out.members.map(annotate),
    citizens:out.citizens.map(name=>({name,club:''})),
    secretary:out.secretary
  };
}

const bodies=await readJson(bodiesPath,[]);
const people=await readJson(peoplePath,[]);
const affiliation=new Map(people.map(p=>[personKey(p.name),p.club||'']));
const annotate=name=>({name,club:affiliation.get(personKey(name))||''});

for(const target of TARGETS){
  const response=await fetch(target.url,{headers:{'user-agent':'Praha8Prehledy/1.0 (+public-data-indexer)'}});
  if(!response.ok)throw new Error(`${response.status} ${target.url}`);
  const parsed=parseCommission(htmlLines(await response.text()),target.name,annotate);
  const entry={type:'Komise rady',name:target.name,url:target.url,materialsUrl:target.materialsUrl,...parsed};
  const index=bodies.findIndex(x=>strip(x.name)===strip(target.name));
  if(index>=0)bodies[index]=entry; else bodies.push(entry);
  console.log(`✓ ${target.name}: ${parsed.members.length} zastupitelů · ${parsed.citizens.length} občanů`);
}

bodies.sort((a,b)=>a.type.localeCompare(b.type,'cs')||a.name.localeCompare(b.name,'cs'));
await writeFile(bodiesPath,JSON.stringify(bodies,null,2)+'\n');

const status=await readJson(statusPath,{});
status.bodies={status:bodies.length?'data načtena':'čeká na naplnění',count:bodies.length,updated:new Date().toISOString(),mode:bodies.length?'aktualizováno':'nenačteno'};
await writeFile(statusPath,JSON.stringify(status,null,2)+'\n');
console.log(`✓ organy.json nyní obsahuje ${bodies.length} orgánů.`);
