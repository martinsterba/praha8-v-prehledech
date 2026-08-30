import puppeteer from 'puppeteer-core';
import {existsSync} from 'node:fs';

const URL='https://praha8.cz/podklady_mc/ZMC20190612audiohlasovani/hlasovani/0001.xml';

function findChrome(){
  const candidates=[
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    process.env.PUPPETEER_EXECUTABLE_PATH
  ].filter(Boolean);
  const hit=candidates.find(existsSync);
  if(!hit)throw new Error('Nenašel jsem Chrome/Edge.');
  return hit;
}

const browser=await puppeteer.launch({headless:true,executablePath:findChrome(),args:['--no-sandbox','--disable-setuid-sandbox']});
try{
  const page=await browser.newPage();
  const r=await page.goto(URL,{waitUntil:'domcontentloaded',timeout:30000});
  console.log('\nLEGACY XML DETAIL — 12.06.2019 / 0001.xml');
  console.log('────────────────────────────────────────');
  console.log(`URL: ${URL}`);
  console.log(`STATUS: ${r?.status()}`);
  const out=await page.evaluate(()=>{
    const text=(document.body?.innerText||'').replace(/\r/g,'');
    const xml=document.documentElement?.outerHTML||'';
    const links=[...document.querySelectorAll('a')].map(a=>({text:a.innerText.trim(),href:a.href}));
    return {text,xml,links};
  });
  console.log('\nTEXT:\n');
  console.log(out.text.slice(0,12000));
  console.log('\nXML/DOM ZAČÁTEK:\n');
  console.log(out.xml.slice(0,16000));
  if(out.links.length){
    console.log('\nLINKS:\n');
    for(const x of out.links.slice(0,100))console.log(`- ${x.text} -> ${x.href}`);
  }
} finally {
  await browser.close();
}
