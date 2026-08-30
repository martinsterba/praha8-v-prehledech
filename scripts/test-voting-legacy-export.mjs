import {existsSync} from 'node:fs';
import puppeteer from 'puppeteer-core';

const chrome=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',process.env.PUPPETEER_EXECUTABLE_PATH].filter(Boolean).find(existsSync);
if(!chrome) throw new Error('Chrome nenalezen.');
const url='https://praha8.cz/podklady_mc/ZMC20221102audiohlasovani/export/html/index.html';
const browser=await puppeteer.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-setuid-sandbox']});
try{
 const page=await browser.newPage();
 const r=await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
 await new Promise(r=>setTimeout(r,500));
 console.log('LEGACY EXPORT 02.11.2022');
 console.log('status:',r?.status());
 console.log('url:',page.url());
 const data=await page.evaluate(()=>({
   title:document.title,
   links:[...document.querySelectorAll('a[href]')].map(a=>({text:(a.innerText||'').trim(),href:a.href})).filter(x=>x.href),
   frames:[...document.querySelectorAll('iframe,frame')].map(x=>x.src),
   text:(document.body?.innerText||'').slice(0,5000),
   html:(document.documentElement?.outerHTML||'').slice(0,5000)
 }));
 console.log('title:',data.title);
 console.log('\nODKAZY:');
 data.links.slice(0,100).forEach((x,i)=>console.log(`${i+1}. ${x.text} -> ${x.href}`));
 console.log('\nFRAME:',data.frames);
 console.log('\nTEXT:\n'+data.text);
 console.log('\nHTML ZAČÁTEK:\n'+data.html);
} finally {await browser.close();}
