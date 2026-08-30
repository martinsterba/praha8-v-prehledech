import {readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import puppeteer from 'puppeteer-core';

const root=resolve(import.meta.dirname,'..');
const raw=JSON.parse(await readFile(resolve(root,'data/smlouvy.json'),'utf8'));
const contracts=Array.isArray(raw)?raw:(raw.contracts||[]);
const local=new Map(contracts.map(x=>[String(x.id),x]));

const findChrome=()=>[
 '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome',
 '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
 '/Applications/Chromium.app/Contents/MacOS/Chromium',
 process.env.PUPPETEER_EXECUTABLE_PATH
].filter(Boolean).find(existsSync);

const exe=findChrome();
if(!exe) throw new Error('Nenašel jsem Chrome/Edge.');
const browser=await puppeteer.launch({headless:true,executablePath:exe,args:['--no-sandbox','--disable-setuid-sandbox']});

try{
 const page=await browser.newPage();
 await page.goto('https://smlouvy.gov.cz/vyhledavani',{waitUntil:'domcontentloaded',timeout:60000});

 // Formulář Registru má stabilní name atributy. Nepokoušíme se je odvozovat z vizuálních labelů,
 // protože společné rodiče formuláře mohou obsahovat text několika polí najednou.
 const detected=await page.evaluate(()=>{
   const all=[...document.querySelectorAll('input,select')].map((el,i)=>({
     i,tag:el.tagName.toLowerCase(),name:el.name||'',id:el.id||'',type:el.type||'',
     placeholder:el.placeholder||''
   }));
   const ico=all.find(x=>x.name==='subject_idnum') || all.find(x=>/subject.*idnum/i.test(x.name));
   const dateCandidates=all.filter(x=>/contract.*date|date.*contract/i.test(x.name) && x.tag==='input');
   let from=dateCandidates.find(x=>/\[from\]|_from$|-from$|from/i.test(x.name));
   let to=dateCandidates.find(x=>/\[to\]|_to$|-to$|to/i.test(x.name));
   if(!from||!to){
     // Záložní hledání podle bloků DOM kolem nadpisu "Datum uzavření smlouvy".
     const nodes=[...document.querySelectorAll('label,div,span,p')].filter(e=>/Datum uzavření smlouvy/i.test((e.textContent||'').trim()));
     for(const n of nodes){
       let box=n;
       for(let depth=0;depth<5 && box;depth++,box=box.parentElement){
         const ins=[...box.querySelectorAll('input[type="text"],input:not([type])')];
         const usable=ins.filter(e=>!/publication_date/i.test(e.name||''));
         if(usable.length===2){
           const asObj=e=>({name:e.name||'',id:e.id||'',tag:'input',type:e.type||'text'});
           from=from||asObj(usable[0]); to=to||asObj(usable[1]);
           break;
         }
       }
       if(from&&to)break;
     }
   }
   return {ico,from,to,all:all.filter(x=>x.tag==='input')};
 });

 if(!detected.ico||!detected.from||!detected.to){
   console.log('Diagnostika relevantních polí formuláře:', detected.all.filter(x=>/subject|date|contract|publication/i.test(`${x.name} ${x.id}`)));
   throw new Error('Nepodařilo se bezpečně najít pole IČO / datum uzavření ve formuláři.');
 }

 const selector=x=>x.id?`#${CSS.escape(x.id)}`:`input[name="${x.name.replaceAll('"','\\"')}"]`;
 const icoSel=selector(detected.ico), dateFromSel=selector(detected.from), dateToSel=selector(detected.to);
 console.log(`Používám pole: IČO=${detected.ico.name||detected.ico.id}, od=${detected.from.name||detected.from.id}, do=${detected.to.name||detected.to.id}`);

 await page.evaluate(({icoSel,dateFromSel,dateToSel})=>{
   const set=(s,v)=>{
     const e=document.querySelector(s);
     if(!e) throw new Error(`Pole nenalezeno: ${s}`);
     const proto=Object.getPrototypeOf(e);
     const desc=Object.getOwnPropertyDescriptor(proto,'value');
     if(desc?.set) desc.set.call(e,v); else e.value=v;
     e.dispatchEvent(new Event('input',{bubbles:true}));
     e.dispatchEvent(new Event('change',{bubbles:true}));
   };
   set(icoSel,'00063797');
   set(dateFromSel,'01.06.2026');
   set(dateToSel,'31.07.2026');
 },{icoSel,dateFromSel,dateToSel});

 const submit=await page.$$('input[type=submit],button[type=submit],button');
 let clicked=false;
 for(const h of submit){
   const t=await h.evaluate(e=>(e.value||e.innerText||'').trim());
   if(/vyhledat/i.test(t)){
     await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded',timeout:60000}).catch(()=>{}),h.click()]);
     clicked=true;break;
   }
 }
 if(!clicked) throw new Error('Nenašel jsem tlačítko Vyhledat.');

 const publicRows=new Map();
 const visited=new Set();
 for(let guard=0;guard<40;guard++){
   const url=page.url(); if(visited.has(url))break; visited.add(url);
   const rows=await page.evaluate(()=>[...document.querySelectorAll('a[href*="/smlouva/"]')].map(a=>{
     const m=a.href.match(/\/smlouva\/(\d+)/); const tr=a.closest('tr');
     return m?{id:m[1],url:a.href,text:(tr?.innerText||'').trim().replace(/\s+/g,' ')}:null;
   }).filter(Boolean));
   for(const r of rows) publicRows.set(r.id,r);
   const next=await page.evaluate(()=>{
     const as=[...document.querySelectorAll('a')];
     const a=as.find(x=>/následující/i.test((x.innerText||'').trim())&&!x.classList.contains('disabled')&&!x.closest('.disabled'));
     return a?.href||'';
   });
   if(!next||visited.has(next))break;
   await page.goto(next,{waitUntil:'domcontentloaded',timeout:60000});
 }

 const publicIds=new Set(publicRows.keys());
 const onlyPublic=[...publicIds].filter(id=>!local.has(id)).map(id=>publicRows.get(id));
 const onlyOpen=[...local.keys()].filter(id=>!publicIds.has(id)).map(id=>local.get(id));
 const report={generatedAt:new Date().toISOString(),criteria:{publisherIco:'00063797',signedFrom:'2026-06-01',signedTo:'2026-07-31',scope:'jen poslední verze'},openDataCount:local.size,publicSearchCount:publicIds.size,onlyPublic,onlyOpen:onlyOpen.map(x=>({id:x.id,idContract:x.idContract,signed:x.signed,subject:x.subject,counterparty:x.counterparty,url:x.url}))};
 await writeFile(resolve(root,'data/contracts-reconciliation.json'),JSON.stringify(report,null,2));

 console.log('\nRECONCILIACE REGISTRU SMLUV'); console.log('─'.repeat(62));
 console.log(`Open data:            ${local.size}`);
 console.log(`Veřejné vyhledávání: ${publicIds.size}`);
 console.log(`Jen veřejné hledání: ${onlyPublic.length}`);
 console.log(`Jen open data:        ${onlyOpen.length}`);
 if(onlyPublic.length){console.log('\nCHYBÍ V OPEN DATECH / NAŠEM DATASETU:');onlyPublic.forEach((x,i)=>console.log(`${i+1}. idVerze ${x.id} · ${x.text}\n   ${x.url}`));}
 if(onlyOpen.length){console.log('\nJE V OPEN DATECH, ALE NE VE VEŘEJNÉM VÝSLEDKU:');onlyOpen.forEach((x,i)=>console.log(`${i+1}. idVerze ${x.id} · ${x.signed} · ${x.counterparty}\n   ${x.subject}\n   ${x.url}`));}
 console.log('\n✓ Report uložen do data/contracts-reconciliation.json');
} finally {await browser.close();}
