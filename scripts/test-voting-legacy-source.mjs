import puppeteer from 'puppeteer-core';
import {existsSync} from 'node:fs';

const URL='https://www.praha8.cz/Prehled-hlasovani-zastupitelstva-02-11-2022.html';
const candidates=[
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  process.env.PUPPETEER_EXECUTABLE_PATH
].filter(Boolean);
const executablePath=candidates.find(existsSync);
if(!executablePath)throw new Error('Chrome nebyl nalezen.');

const browser=await puppeteer.launch({headless:true,executablePath,args:['--no-sandbox','--disable-setuid-sandbox']});
try{
  const page=await browser.newPage();
  await page.goto(URL,{waitUntil:'domcontentloaded',timeout:30000});
  const info=await page.evaluate(()=>{
    const links=[...document.querySelectorAll('a[href]')].map(a=>({text:(a.innerText||'').trim(),href:a.href}));
    const frames=[...document.querySelectorAll('iframe[src],frame[src]')].map(x=>x.src);
    const embeds=[...document.querySelectorAll('embed[src],object[data]')].map(x=>x.getAttribute('src')||x.getAttribute('data'));
    const scripts=[...document.querySelectorAll('script[src]')].map(x=>x.src);
    const interestingLinks=links.filter(x=>/hlas|audio|podklady|export|html|pdf|zmc|bitest/i.test(`${x.text} ${x.href}`));
    const text=document.body.innerText.replace(/\r/g,'').split('\n').map(x=>x.trim()).filter(Boolean);
    return {url:location.href,title:document.title,interestingLinks,frames,embeds,scripts:scripts.filter(x=>/hlas|audio|podklady|export|zmc|bitest/i.test(x)),sample:text.slice(0,80)};
  });
  console.log('LEGACY HLASOVÁNÍ — DIAGNOSTIKA ZDROJE');
  console.log('──────────────────────────────────────');
  console.log('URL:',info.url);
  console.log('TITLE:',info.title);
  console.log('\nZAJÍMAVÉ ODKAZY:');
  for(const x of info.interestingLinks)console.log(`- ${x.text || '(bez textu)'} -> ${x.href}`);
  console.log('\nIFRAME/FRAME:');
  for(const x of info.frames)console.log('-',x);
  console.log('\nEMBED/OBJECT:');
  for(const x of info.embeds)console.log('-',x);
  console.log('\nZAJÍMAVÉ SCRIPTY:');
  for(const x of info.scripts)console.log('-',x);
  console.log('\nVÝŘEZ TEXTU STRÁNKY:');
  console.log(info.sample.join('\n'));
} finally {
  await browser.close();
}
