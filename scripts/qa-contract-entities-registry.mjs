import {readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import puppeteer from 'puppeteer-core';

const root=resolve(import.meta.dirname,'..');
const entitiesFile=resolve(root,'data','contract-entities.json');
if(!existsSync(entitiesFile)) throw new Error('Chybí data/contract-entities.json. Nejdřív spusť npm run sync:contract-entities.');
const registry=JSON.parse(await readFile(entitiesFile,'utf8'));
const entities=(registry.entities||registry.items||[]).filter(x=>x && x.ico && x.kind!=='municipality' && !/IPODEC/i.test(x.name||''));
if(!entities.length) throw new Error('Entity registry neobsahuje žádné cílové organizace s IČO.');

const chrome=[
 '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome',
 '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
 '/Applications/Chromium.app/Contents/MacOS/Chromium',
 process.env.PUPPETEER_EXECUTABLE_PATH
].filter(Boolean).find(existsSync);
if(!chrome) throw new Error('Nenašel jsem Chrome/Edge.');

const browser=await puppeteer.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-setuid-sandbox']});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const rows=[];
try{
  const page=await browser.newPage();
  page.setDefaultTimeout(30000);
  console.log('QA živého Registru smluv pro organizace Prahy 8 — v2.6.3');
  console.log('─'.repeat(68));
  console.log(`Kontroluji ${entities.length} subjektů přímo přes veřejné vyhledávání.`);
  console.log('Nestahuji měsíční open-data dumpy ani 24,7 GB XML.\n');

  for(let i=0;i<entities.length;i++){
    const e=entities[i];
    let count=null, ok=false, err='';
    try{
      await page.goto('https://smlouvy.gov.cz/vyhledavani',{waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForSelector('input[name="subject_idnum"]');
      await page.evaluate((ico)=>{
        const inp=document.querySelector('input[name="subject_idnum"]');
        const proto=Object.getPrototypeOf(inp); const desc=Object.getOwnPropertyDescriptor(proto,'value');
        if(desc?.set) desc.set.call(inp,ico); else inp.value=ico;
        inp.dispatchEvent(new Event('input',{bubbles:true})); inp.dispatchEvent(new Event('change',{bubbles:true}));
      },e.ico);
      const clicked=await page.evaluate(()=>{
        const candidates=[...document.querySelectorAll('button,input[type="submit"]')];
        const el=candidates.find(x=>/vyhledat/i.test((x.innerText||x.value||'').trim()));
        if(!el)return false; el.click(); return true;
      });
      if(!clicked) throw new Error('Tlačítko Vyhledat nenalezeno');
      await Promise.race([
        page.waitForNavigation({waitUntil:'domcontentloaded',timeout:60000}).catch(()=>{}),
        page.waitForFunction(()=>/Počet nalezených záznamů/i.test(document.body.innerText),{timeout:60000}).catch(()=>{})
      ]);
      await sleep(250);
      const txt=await page.evaluate(()=>document.body.innerText||'');
      const m=txt.match(/Počet\s+nalezených\s+záznamů\s*([0-9\s.]+)/i);
      if(!m) throw new Error('Na stránce jsem nenašel počet nalezených záznamů');
      count=Number(m[1].replace(/\D/g,''));
      if(!Number.isFinite(count)) throw new Error('Počet výsledků není číslo');
      ok=true;
    }catch(ex){err=String(ex?.message||ex).slice(0,180)}
    rows.push({name:e.name,ico:e.ico,kind:e.kind||e.type||'',subtype:e.subtype||'',count,ok,error:err});
    const val=ok?count.toLocaleString('cs-CZ'):`CHYBA: ${err}`;
    console.log(`[${String(i+1).padStart(2)}/${entities.length}] ${e.ico} · ${e.name} → ${val}`);
  }

  const okRows=rows.filter(x=>x.ok), failed=rows.filter(x=>!x.ok), zero=okRows.filter(x=>x.count===0);
  const total=okRows.reduce((n,x)=>n+x.count,0);
  console.log('\nSOUHRN'); console.log('─'.repeat(68));
  console.log(`Úspěšně ověřeno: ${okRows.length}/${rows.length}`);
  console.log(`Chyby:            ${failed.length}`);
  console.log(`Subjekty s 0:     ${zero.length}`);
  console.log(`Součet výsledků jednotlivých subjektů: ${total.toLocaleString('cs-CZ')} (není agregát celé Prahy 8, jen kontrolní součet)`);
  if(failed.length){console.log('\nCHYBY:');failed.forEach(x=>console.log(`- ${x.ico} ${x.name}: ${x.error}`));}
  if(zero.length){console.log('\nNULOVÉ VÝSLEDKY:');zero.forEach(x=>console.log(`- ${x.ico} ${x.name}`));}
  const report={generatedAt:new Date().toISOString(),source:'https://smlouvy.gov.cz/vyhledavani',method:'live-public-search-counts',entities:rows,summary:{totalEntities:rows.length,ok:okRows.length,failed:failed.length,zero:zero.length,sumCounts:total}};
  await writeFile(resolve(root,'data','contract-entities-registry-qa.json'),JSON.stringify(report,null,2));
  console.log('\n✓ Report uložen do data/contract-entities-registry-qa.json');
  if(failed.length)process.exitCode=2;
} finally {await browser.close();}
