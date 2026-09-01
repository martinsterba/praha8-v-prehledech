import {readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import puppeteer from 'puppeteer-core';

const root=resolve(import.meta.dirname,'..');
const peoplePath=resolve(root,'data','lide.json');
const bodiesPath=resolve(root,'data','organy.json');
const statusPath=resolve(root,'data','source-status.json');
const UA='Praha8Prehledy/1.7 (+public-data-indexer; public sources only)';

const readJson=async(path,fallback)=>{try{return JSON.parse(await readFile(path,'utf8'))}catch{return fallback}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const personKey=(name='')=>{
  const drop=new Set(['mgr','bc','ing','phdr','judr','rndr','mvdr','doc','prof','phd','mba','mpa','ma','dis','csc','dba','bca','et']);
  return norm(name).split(/\s+/).filter(Boolean).filter(x=>!drop.has(x)&&x.length>1).slice(0,2).sort().join(' ');
};
function findChrome(){
  const candidates=[
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    process.env.PUPPETEER_EXECUTABLE_PATH
  ].filter(Boolean);
  const hit=candidates.find(existsSync);
  if(!hit)throw new Error('Nenašel jsem Chrome/Chromium. Nastavte PUPPETEER_EXECUTABLE_PATH.');
  return hit;
}
async function goto(page,url,attempts=3){
  let last;
  for(let i=1;i<=attempts;i++){
    try{
      await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
      return;
    }catch(e){
      last=e;
      if(i<attempts){console.warn(`   ↻ ${url}: pokus ${i}/${attempts} selhal, opakuji…`);await sleep(1500)}
    }
  }
  throw last;
}

const people=await readJson(peoplePath,[]);
if(!Array.isArray(people)||!people.length)throw new Error('Chybí data/lide.json. Nejprve načtěte zastupitelstvo.');
const affiliation=new Map(people.map(p=>[personKey(p.name),p.club||'']));
const annotate=name=>({name,club:affiliation.get(personKey(name))||''});

const browser=await puppeteer.launch({headless:true,executablePath:findChrome(),args:['--no-sandbox','--disable-setuid-sandbox']});
const page=await browser.newPage();
await page.setUserAgent(UA);
const bodies=[];

try{
  console.log('\nKOMISE, VÝBORY A ZVLÁŠTNÍ ORGÁNY MČ PRAHA 8');
  console.log('────────────────────────────────────────────');

  // Komise: discovery děláme ze dvou oficiálních variant seznamu a sjednocujeme podle názvu.
  // Mobilní seznam je důležitý: obsahuje i položky, které desktopová varianta někdy při scrapingu vynechala.
  const listUrls=[
    'https://m.praha8.cz/Komise',
    'https://www.praha8.cz/komise-rady-mestske-casti-praha-8.html'
  ];
  const byName=new Map();
  for(const listUrl of listUrls){
    await goto(page,listUrl);
    const links=await page.evaluate(()=>[...document.querySelectorAll('a[href]')]
      .map(a=>({name:(a.textContent||'').replace(/\s+/g,' ').trim(),url:a.href}))
      .filter(x=>/^(Komise pro|Redakční rada)/i.test(x.name))
      .filter(x=>!/archiv|sociálně-právní ochranu dětí/i.test(x.name)));
    for(const x of links){
      const key=x.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
      // Preferujeme mobilní detail: je jednodušší a stabilnější, ale název zůstává zdrojový.
      const old=byName.get(key);
      if(!old||/m\.praha8\.cz/i.test(x.url))byName.set(key,x);
    }
  }
  const commissionLinks=[...byName.values()].sort((a,b)=>a.name.localeCompare(b.name,'cs'));
  if(commissionLinks.length<14)throw new Error(`Seznam komisí je neúplný: nalezeno jen ${commissionLinks.length}. Dataset nepřepisuji.`);
  console.log(`   Seznam komisí: ${commissionLinks.length} položek.`);

  for(const c of commissionLinks){
    await goto(page,c.url);
    const sec=await page.evaluate(()=>{
      const main=document.querySelector('main')||document.querySelector('article')||document.body;
      const lines=(main.innerText||'').split('\n').map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean);
      const materials=[...main.querySelectorAll('a[href]')].find(a=>/materiály z jednání|materialy z jednani/i.test((a.textContent||'').trim()));
      const out={chair:'',members:[],citizens:[],secretary:'',materialsUrl:materials?.href||''};
      let mode='';
      for(const line of lines){
        if(/^Předsed(a|kyně):?$/i.test(line)){mode='chair';continue}
        if(/^Členové z řad (zastupitelů|členů ZMČ):?$/i.test(line)){mode='members';continue}
        if(/^Členové z řad občanů:?$/i.test(line)){mode='citizens';continue}
        if(/^Členové:?$/i.test(line)){mode='members';continue}
        if(/^Tajemník:?$|^Tajemnice:?$/i.test(line)){mode='secretary';continue}
        if(/^(Související odkazy|Mohlo by vás|Aktualizováno:)/i.test(line)){mode='';continue}
        if(mode==='chair'&&!out.chair&&line.length<120){out.chair=line;mode='';continue}
        if(mode==='members'&&line.length<120){out.members.push(line);continue}
        if(mode==='citizens'&&line.length<120){out.citizens.push(line);continue}
        if(mode==='secretary'&&!out.secretary&&line.length<120){out.secretary=line;mode='';continue}
      }
      return out;
    });
    if(!sec.chair&&!sec.members.length)throw new Error(`Komise „${c.name}“ nemá rozpoznané složení. Dataset nepřepisuji.`);
    bodies.push({
      type:'Komise rady',name:c.name,url:c.url,materialsUrl:sec.materialsUrl||'',
      chair:sec.chair?annotate(sec.chair):null,
      members:sec.members.map(annotate),
      citizens:sec.citizens.map(name=>({name,club:''})),
      secretary:sec.secretary||''
    });
    console.log(`   ✓ ${c.name}`);
  }

  // Výbory zastupitelstva.
  const committeesUrl='https://www.praha8.cz/vybory-zastupitelstva-mestske-casti-praha-8.html';
  await goto(page,committeesUrl);
  const committeeData=await page.evaluate(()=>{
    const text=(document.querySelector('main')||document.body).innerText||'';
    const names=['Finanční výbor','Kontrolní výbor'];
    return names.map((name,idx)=>{
      const start=text.indexOf(name);
      if(start<0)return null;
      const next=idx+1<names.length?text.indexOf(names[idx+1],start+name.length):-1;
      const end=next>start?next:text.indexOf('Mohlo by vás',start);
      const lines=text.slice(start,end>start?end:undefined).split('\n').map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean);
      const out={name,chair:'',members:[],citizens:[],secretary:''};let mode='';
      for(const line of lines.slice(1)){
        if(/^Předseda:?$/i.test(line)||/^Předsedkyně:?$/i.test(line)){mode='chair';continue}
        if(/^Členové z řad členů ZMČ:?$/i.test(line)||/^Členové z řad zastupitelů:?$/i.test(line)){mode='members';continue}
        if(/^Členové z řad občanů:?$/i.test(line)){mode='citizens';continue}
        if(/^Tajemník:?$|^Tajemnice:?$/i.test(line)){mode='secretary';continue}
        if(/^(Související odkazy|Materiály z jednání|Mohlo by vás)/i.test(line)){mode='';continue}
        if(mode==='chair'&&!out.chair&&line.length<120){out.chair=line;mode='';continue}
        if(mode==='members'&&line.length<120){out.members.push(line);continue}
        if(mode==='citizens'&&line.length<120){out.citizens.push(line);continue}
        if(mode==='secretary'&&!out.secretary&&line.length<120){out.secretary=line;mode='';continue}
      }
      return out;
    }).filter(Boolean);
  });
  if(committeeData.length!==2||committeeData.some(x=>!x.chair&&!x.members.length))throw new Error(`Výbory nejsou kompletní (${committeeData.length}/2). Dataset nepřepisuji.`);
  for(const x of committeeData){
    const materialsUrl=/kontrolní/i.test(x.name)?'https://www.praha8.cz/Materialy-KV':'https://www.praha8.cz/Materialy-Financniho-vyboru';
    bodies.push({type:'Výbor zastupitelstva',name:x.name,url:committeesUrl,materialsUrl,chair:x.chair?annotate(x.chair):null,members:x.members.map(annotate),citizens:x.citizens.map(name=>({name,club:''})),secretary:x.secretary||''});
  }
  console.log('   ✓ Výbory: 2/2');

  // Zvláštní orgány – bez statického snapshotu. Po volbách chceme raději bezpečně selhat
  // a ponechat poslední validní dataset, než zapsat staré složení jako nové.
  const specialsUrl='https://www.praha8.cz/zvlastni-organy-mc';
  await goto(page,specialsUrl);
  const specials=await page.evaluate(()=>{
    const main=document.querySelector('main')||document.querySelector('article')||document.body;
    const lines=(main.innerText||'').split('\n').map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean);
    const starts=[];
    for(let i=0;i<lines.length;i++){
      if(/^Komise\s+povodňová$/i.test(lines[i])||/^Povodňová komise/i.test(lines[i])||/^Komise\s+pro\s+sociálně-právní ochranu\s+dětí/i.test(lines[i]))starts.push(i);
    }
    const out=[];
    for(let si=0;si<starts.length;si++){
      const chunk=lines.slice(starts[si],starts[si+1]??lines.length);
      const rawName=chunk[0]||'';
      const item={name:/povodň/i.test(rawName)?'Povodňová komise':'Komise pro sociálně-právní ochranu dětí',chair:'',viceChair:'',members:[],citizens:[],secretary:''};
      let mode='';
      for(const line of chunk.slice(1)){
        if(/^Předseda:?$/i.test(line)||/^Předsedkyně:?$/i.test(line)){mode='chair';continue}
        if(/^Zástupce předsedy:?$/i.test(line)||/^Zástupkyně předsedy:?$/i.test(line)||/^Místopředseda:?$/i.test(line)||/^Místopředsedkyně:?$/i.test(line)){mode='vice';continue}
        if(/^Členové komise z řad zastupitelstva MČ:?$/i.test(line)||/^Členové z řad zastupitelstva MČ:?$/i.test(line)){mode='members';continue}
        if(/^Členové komise:?$/i.test(line)||/^Členové:?$/i.test(line)||/^Členové komise z fyzických osob/i.test(line)){mode='citizens';continue}
        if(/^Tajemník komise:?$/i.test(line)||/^Tajemnice komise:?$/i.test(line)||/^Tajemník:?$/i.test(line)||/^Tajemnice:?$/i.test(line)){mode='secretary';continue}
        if(/^(Aktualizováno|Související odkazy|Mohlo by vás)/i.test(line)){mode='';continue}
        if(mode==='chair'&&!item.chair&&line.length<160){item.chair=line;mode='';continue}
        if(mode==='vice'&&!item.viceChair&&line.length<160){item.viceChair=line;mode='';continue}
        if(mode==='members'&&line.length<160){item.members.push(line);continue}
        if(mode==='citizens'&&line.length<180){item.citizens.push(line);continue}
        if(mode==='secretary'&&!item.secretary&&line.length<160){item.secretary=line;mode='';continue}
      }
      if(item.chair||item.members.length||item.citizens.length)out.push(item);
    }
    return out;
  });
  const uniqueSpecials=[...new Map(specials.map(x=>[x.name,x])).values()];
  if(uniqueSpecials.length!==2)throw new Error(`Zvláštní orgány nejsou kompletní (${uniqueSpecials.length}/2). Dataset nepřepisuji.`);
  for(const x of uniqueSpecials){
    const memberNames=[...(x.members||[])],citizens=[];
    for(const name of (x.citizens||[])){
      if(affiliation.has(personKey(name)))memberNames.push(name);else citizens.push(name);
    }
    const members=memberNames.map(annotate);
    if(x.viceChair){const vp=annotate(x.viceChair);vp.role='místopředseda/místopředsedkyně';members.unshift(vp)}
    bodies.push({type:'Zvláštní orgán',name:x.name,url:specialsUrl,materialsUrl:'',chair:x.chair?annotate(x.chair):null,members,citizens:citizens.map(name=>({name,club:''})),secretary:x.secretary||''});
  }
  console.log('   ✓ Zvláštní orgány: 2/2');

  // Atomická kontrola kompletnosti: počet komisí musí odpovídat discovery seznamu.
  const commissions=bodies.filter(x=>x.type==='Komise rady');
  const committees=bodies.filter(x=>x.type==='Výbor zastupitelstva');
  const specialBodies=bodies.filter(x=>x.type==='Zvláštní orgán');
  if(commissions.length!==commissionLinks.length)throw new Error(`Komise: načteno ${commissions.length}/${commissionLinks.length}. Dataset nepřepisuji.`);
  if(committees.length!==2||specialBodies.length!==2)throw new Error('Kontrola úplnosti orgánů neprošla. Dataset nepřepisuji.');

  bodies.sort((a,b)=>a.type.localeCompare(b.type,'cs')||a.name.localeCompare(b.name,'cs'));
  await writeFile(bodiesPath,JSON.stringify(bodies,null,2)+'\n');

  const status=await readJson(statusPath,{});
  status.bodies={status:'data načtena',count:bodies.length,updated:new Date().toISOString(),mode:'aktualizováno',commissions:commissions.length,committees:committees.length,specialBodies:specialBodies.length};
  await writeFile(statusPath,JSON.stringify(status,null,2)+'\n');

  console.log(`\n✅ Uloženo: ${commissions.length} komisí · ${committees.length} výbory · ${specialBodies.length} zvláštní orgány = ${bodies.length} orgánů.`);
}finally{
  await page.close().catch(()=>{});
  await browser.close().catch(()=>{});
}
