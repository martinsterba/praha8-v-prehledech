import {existsSync} from 'node:fs';
import puppeteer from 'puppeteer-core';

const URL='https://www.praha8.cz/Prehled-hlasovani-zastupitelstva-12-06-2019.html';
function findChrome(){
  const candidates=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge','/Applications/Chromium.app/Contents/MacOS/Chromium',process.env.PUPPETEER_EXECUTABLE_PATH].filter(Boolean);
  const hit=candidates.find(existsSync); if(!hit)throw new Error('Chrome nenalezen.'); return hit;
}
const browser=await puppeteer.launch({headless:true,executablePath:findChrome(),args:['--no-sandbox','--disable-setuid-sandbox']});
try{
  const page=await browser.newPage();
  const seen=[];
  page.on('response',r=>{const u=r.url(); if(/hlasov|podklady|zmc|export|audio/i.test(u))seen.push({status:r.status(),url:u})});
  const r=await page.goto(URL,{waitUntil:'networkidle2',timeout:45000});
  console.log('\nDEEP LEGACY 12.06.2019');
  console.log('status:',r?.status());
  console.log('url:',page.url());
  console.log('title:',await page.title());
  const data=await page.evaluate(()=>{
    const attrs=[];
    for(const el of document.querySelectorAll('*')){
      for(const a of ['href','src','data','action','onclick']){
        const v=el.getAttribute?.(a); if(v && /hlasov|podklady|zmc|export|audio/i.test(v))attrs.push(`${el.tagName}.${a} = ${v}`);
      }
    }
    const html=document.documentElement.innerHTML||'';
    const matches=[...html.matchAll(/[^\s"'<>]{0,80}(?:hlasov|podklady|ZMC|export|audio)[^\s"'<>]{0,120}/gi)].map(m=>m[0]);
    return {attrs:[...new Set(attrs)],matches:[...new Set(matches)].slice(0,200),text:(document.body?.innerText||'').slice(0,12000)};
  });
  console.log('\nDOM ATRIBUTY:');
  for(const x of data.attrs)console.log('-',x);
  console.log('\nHTML MATCHES:');
  for(const x of data.matches)console.log('-',x);
  console.log('\nFRAMES:');
  for(const f of page.frames())console.log('-',f.url());
  console.log('\nNETWORK RESPONSES:');
  for(const x of [...new Map(seen.map(x=>[x.url,x])).values()])console.log(`- ${x.status} ${x.url}`);
  console.log('\nTEXT VÝŘEZ:');
  console.log(data.text);
} finally {await browser.close()}
